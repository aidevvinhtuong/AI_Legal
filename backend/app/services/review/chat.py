"""
Nối chat sửa văn bản (PT1) vào DB.

Điểm thiết kế quan trọng: **chat KHÔNG ghi tài liệu.** Nó sinh `ai_proposals`,
người dùng chấp nhận thì đi qua `save_fields()` — đúng một đường ghi duy nhất,
đúng một lần đi qua allow-list Lớp 1 và hậu kiểm Lớp 2 (bất biến B1).

Nếu chat được ghi trực tiếp thì hệ thống có hai đường ghi, và cái thứ hai sớm
muộn sẽ thiếu một lớp kiểm.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, ReviewStatus
from app.domain.errors import ConflictError, LockedError, NotFoundError, ValidationError
from app.domain.rbac import Principal, assert_can_edit_document
from app.infra.models import (
    AiProposal,
    AiRun,
    AuditLog,
    ChatMessage,
    ContractReview,
    DocumentField,
    ReviewVersion,
)
from app.infra.prompt_loader import load as load_prompt
from app.services.ai import chat as chat_lib
from app.services.config import checklist
from app.services.document.allowlist import FieldChange

log = logging.getLogger("ailegal.review.chat")

MAX_MESSAGE_CHARS = 4000
HISTORY_TURNS = 8

# `region_kind` của vùng KHÔNG ghi được → lý do để nói với người dùng
_UNWRITABLE = {"empty": "empty", "cross_table": "cross_table"}


def send(db: Session, principal: Principal, review: ContractReview, content: str) -> ContractReview:
    """
    Một lượt chat: lưu câu của user → resolve đích → (nếu hợp lệ) gọi LLM →
    lưu trả lời + đề xuất.

    Trạng thái cấm ghi tài liệu thì cũng cấm chat sửa: đang chờ duyệt mà chủ
    ticket sinh đề xuất mới thì người duyệt xem một đằng, thực tế một nẻo.
    """
    principal.require(Permission.CONTRACTS)
    content = (content or "").strip()
    if not content:
        raise ValidationError("Nội dung yêu cầu đang rỗng")
    if len(content) > MAX_MESSAGE_CHARS:
        raise ValidationError(
            f"Yêu cầu quá dài (tối đa {MAX_MESSAGE_CHARS} ký tự)", code="message_too_long"
        )
    if ReviewStatus(review.status).blocks_document_write:
        raise LockedError(f"Không sửa được tài liệu khi ticket đang ở trạng thái “{review.status}”")
    assert_can_edit_document(
        principal, owner_id=review.owner_id, status=ReviewStatus(review.status)
    )

    db.add(
        ChatMessage(review_id=review.id, role="user", content=content, author_id=principal.user_id)
    )
    db.flush()

    fields = _chat_fields(db, review)
    # Bỏ các lượt `refusal` khỏi ngữ cảnh: đó là câu hệ thống tự sinh, không
    # phải suy luận của model. Để lại thì model đọc mấy câu "không xác định được
    # vùng nào" phía trên rồi nhại lại y hệt thay vì làm việc.
    history = [
        (m.role, m.content)
        for m in db.execute(
            select(ChatMessage)
            .where(ChatMessage.review_id == review.id, ChatMessage.kind != "refusal")
            .order_by(ChatMessage.created_at.desc())
            .limit(HISTORY_TURNS)
        ).scalars()
    ][::-1][:-1]  # bỏ chính câu vừa thêm

    merged = checklist.merge_for_contract_name(db, review.contract_type_id)
    prompt = load_prompt("chat_edit")
    model, _, _, model_hash = _model(merged)

    result = chat_lib.run(
        message=content,
        fields=fields,
        history=history,
        clauses=merged.clauses,
        contract_type=review.contract_type_label or review.contract_type_id,
        model=model,
        system_prompt=prompt.content,
    )

    _persist(
        db,
        review,
        principal,
        result,
        prompt_version=prompt.version,
        model_id=(model.model if model else "rule-based"),
        model_hash=model_hash,
        merged=merged,
    )
    return review


def _chat_fields(db: Session, review: ContractReview) -> list[chat_lib.ChatField]:
    """
    Vùng của tài liệu, kèm **số điều khoản**.

    Số điều bắt buộc phải có: người dùng nói "sửa Điều 14" chứ không nói permId.
    Mà số điều do Word sinh từ `numbering.xml`, KHÔNG có trong luồng text (bẫy
    F5) — nên phải resolve từ tài liệu, không grep được.

    Thiếu nó thì `_locked_hint` không nhận ra yêu cầu nhắm vào vùng khoá, và
    chat sẽ gọi LLM cho đúng thứ lẽ ra phải bị từ chối. Đã đo được trên máy dev.
    """
    version = db.execute(
        select(ReviewVersion)
        .where(ReviewVersion.review_id == review.id)
        .order_by(ReviewVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        return []

    rows = list(
        db.execute(
            select(DocumentField)
            .where(DocumentField.version_id == version.id)
            .order_by(DocumentField.ordinal)
        ).scalars()
    )
    citations = _citations(db, review, version)

    fields = [
        chat_lib.ChatField(
            perm_id=f.perm_id,
            label=f.label or f"Vùng mở #{f.ordinal}",
            value=f.value_text,
            writable=f.writable,
            citation=citations.get(f.perm_id, ""),
            # Vùng mở nhưng writer không đụng được: rỗng (không có `w:rPr` để
            # kế thừa) hoặc bắc qua ranh giới bảng. KHÁC hẳn "Legal khoá" — nói
            # nhầm thì người dùng đi hỏi Legal một việc Legal không giải quyết được.
            unwritable_reason=_UNWRITABLE.get(f.region_kind, "locked"),
        )
        for f in rows
    ]

    # Các điều khoản KHOÁ cũng phải có mặt — nếu không, "sửa Điều 14" trông như
    # "không xác định được đích" thay vì "vùng này bị khoá".
    known = {f.perm_id for f in fields}
    for citation, text in _locked_clauses(db, review, version).items():
        if citation in known:
            continue
        fields.append(
            chat_lib.ChatField(
                perm_id=citation,
                label=citation,
                value=text,
                writable=False,
                citation=citation,
            )
        )
    return fields


def _document_segments(db: Session, review: ContractReview, version: ReviewVersion):
    """Đọc tài liệu của version hiện tại → danh sách clause unit đã resolve số."""
    from app.infra.models import ReviewFile
    from app.services.ai.segmenter import segment as segment_document
    from app.services.document.ooxml import DocxPackage
    from app.services.document.ooxml_reader import OoxmlReader
    from app.services.storage.objects import get_storage

    file_row = db.get(ReviewFile, version.file_id) if version.file_id else None
    if file_row is None:
        return []
    blob = get_storage().get(file_row.storage_key)
    inventory = OoxmlReader().read(DocxPackage.load(blob))
    return segment_document(inventory.paragraphs)


def _citations(db: Session, review: ContractReview, version: ReviewVersion) -> dict[str, str]:
    """`permId` → số điều khoản chứa nó."""
    out: dict[str, str] = {}
    try:
        for item in _document_segments(db, review, version):
            if not item.citation:
                continue
            for perm_id in item.perm_ids:
                out.setdefault(perm_id, item.citation)
    except Exception as e:  # tài liệu hỏng thì chat vẫn phải chạy, chỉ kém chính xác
        log.warning("không resolve được số điều khoản cho %s: %s", review.code, e)
    return out


def _locked_clauses(db: Session, review: ContractReview, version: ReviewVersion) -> dict[str, str]:
    """Số điều khoản → nội dung, cho các clause KHÔNG chứa vùng mở nào."""
    out: dict[str, str] = {}
    try:
        for item in _document_segments(db, review, version):
            if item.citation and not item.perm_ids:
                out.setdefault(item.citation, item.full_text[:600])
    except Exception:
        return {}
    return out


def _model(merged: checklist.MergedChecklist):
    # Import tại chỗ: `ai_review` cũng import module này khi chạy pipeline
    from app.services.review.ai_review import _clients

    return _clients(merged)


def _persist(
    db: Session,
    review: ContractReview,
    principal: Principal,
    result: chat_lib.ChatResult,
    *,
    prompt_version: str,
    model_id: str,
    model_hash: str,
    merged: checklist.MergedChecklist,
) -> None:
    from app.infra.settings import get_settings

    run = AiRun(
        review_id=review.id,
        version_no=review.version,
        stage="chat_edit",
        model_id=model_id,
        model_hash=model_hash,
        prompt_stage="chat_edit",
        prompt_version=prompt_version,
        checklist_config_version=merged.config_version_key,
        temperature=0,
        seed=get_settings().LLM_SEED,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        latency_ms=result.latency_ms,
        status="refused" if result.refused else "ok",
        # `is_fallback` = KHÔNG gọi được mô hình. Từ chối vì nhắm vào vùng khoá
        # là hoạt động ĐÚNG, không phải chạy dự phòng — đừng gộp hai thứ.
        is_fallback=not result.called_llm and not result.refused,
        error=result.refusal_reason or None,
        score_breakdown={"targets": result.targets, "calledLlm": result.called_llm},
    )
    db.add(run)
    db.flush()

    for finding in result.injections:
        db.add(
            AuditLog(
                actor_id=principal.user_id,
                actor_name=principal.username,
                actor_role=principal.role.value,
                action="prompt_injection_detected",
                entity_type="chat_message",
                entity_id=str(review.id),
                new_value={"pattern": finding.pattern, "excerpt": finding.excerpt},
            )
        )

    labels = {f.perm_id: f.label for f in _chat_fields(db, review)}
    for edit in result.edits:
        db.add(
            AiProposal(
                review_id=review.id,
                run_id=run.id,
                kind="A",
                field_id=edit.perm_id,
                title=f"Chat đề xuất sửa: {labels.get(edit.perm_id, edit.perm_id)}",
                reason=edit.reason,
                original_text=_current_value(db, review, edit.perm_id)[:2000],
                proposed_text=edit.new_text,
                status="pending",
                confidence=0,
            )
        )

    db.add(
        ChatMessage(
            review_id=review.id,
            role="assistant",
            content=result.reply,
            author_id=None,
            kind="refusal" if result.refused and not result.called_llm else "text",
        )
    )
    db.flush()


def _current_value(db: Session, review: ContractReview, perm_id: str) -> str:
    row = db.execute(
        select(DocumentField)
        .where(DocumentField.review_id == review.id, DocumentField.perm_id == perm_id)
        .order_by(DocumentField.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return row.value_text if row else ""


# ─────────────────────────────────────────────────────────────────────────────
# Chấp nhận / bỏ đề xuất
# ─────────────────────────────────────────────────────────────────────────────
def decide_proposal(
    db: Session,
    principal: Principal,
    review: ContractReview,
    proposal_id: Any,
    status: str,
) -> ContractReview:
    """
    Chấp nhận một đề xuất = ghi tài liệu. Nên nó đi qua `save_fields()`, KHÔNG
    có đường riêng — allow-list và hậu kiểm chạy y như mọi lần ghi khác.
    """
    from app.services.review import service

    if status not in ("accepted", "rejected", "undone"):
        raise ValidationError("status chỉ nhận 'accepted', 'rejected' hoặc 'undone'")

    proposal = db.get(AiProposal, proposal_id)
    if proposal is None or proposal.review_id != review.id:
        raise NotFoundError("Đề xuất")
    if proposal.kind != "A":
        raise ValidationError(
            "Đề xuất Loại B chỉ là chú thích cho vùng khoá, không áp dụng được",
            code="proposal_annotation_only",
        )

    if status == "rejected":
        proposal.status = "rejected"
        db.flush()
        return review

    if status == "undone":
        return _undo(db, principal, review, proposal)

    service.save_fields(
        db,
        principal,
        review,
        [FieldChange(perm_id=proposal.field_id or "", value=proposal.proposed_text)],
    )
    proposal.status = "accepted"
    db.flush()
    return review


def _undo(
    db: Session, principal: Principal, review: ContractReview, proposal: AiProposal
) -> ContractReview:
    """
    Hoàn tác một đề xuất đã áp dụng — bằng cách GHI LẠI giá trị cũ, không phải
    xoá version.

    `review_versions` là snapshot bất biến: xoá đi thì lịch sử nói dối. Undo là
    một thay đổi mới, và nó phải để lại vết như mọi thay đổi khác.

    **Chỉ hoàn tác được khi vùng đó chưa bị sửa tiếp.** `original_text` chụp lúc
    tạo đề xuất; nếu từ đó tới giờ người dùng đã sửa thêm thì ghi đè lại là xoá
    mất công của họ mà không báo. Thà từ chối và nói rõ.
    """
    from app.services.review import service

    if proposal.status != "accepted":
        raise ValidationError("Chỉ hoàn tác được đề xuất đã áp dụng", code="proposal_not_accepted")

    current = _current_value(db, review, proposal.field_id or "")
    if current.strip() != (proposal.proposed_text or "").strip():
        raise ConflictError(
            "Vùng này đã được sửa tiếp sau khi áp dụng đề xuất — hoàn tác sẽ xoá mất "
            "thay đổi mới. Hãy sửa tay về giá trị mong muốn.",
            code="proposal_superseded",
        )

    service.save_fields(
        db,
        principal,
        review,
        [FieldChange(perm_id=proposal.field_id or "", value=proposal.original_text)],
    )
    proposal.status = "pending"  # quay lại trạng thái chờ, áp dụng lại được
    db.flush()
    return review


def undo_all(db: Session, principal: Principal, review: ContractReview) -> ContractReview:
    """Hoàn tác mọi đề xuất đã áp dụng mà vùng chưa bị sửa tiếp, trong MỘT version."""
    from app.services.review import service

    accepted = list(
        db.execute(
            select(AiProposal).where(
                AiProposal.review_id == review.id,
                AiProposal.kind == "A",
                AiProposal.status == "accepted",
            )
        ).scalars()
    )
    revertible = [
        p
        for p in accepted
        if p.field_id
        and _current_value(db, review, p.field_id).strip() == (p.proposed_text or "").strip()
    ]
    if not revertible:
        raise ValidationError("Không có đề xuất nào hoàn tác được", code="no_revertible_proposal")

    by_field = {p.field_id: p for p in revertible}
    service.save_fields(
        db,
        principal,
        review,
        [FieldChange(perm_id=k or "", value=v.original_text) for k, v in by_field.items()],
    )
    for p in revertible:
        p.status = "pending"
    db.flush()
    return review


def accept_all(db: Session, principal: Principal, review: ContractReview) -> ContractReview:
    """
    Áp mọi đề xuất Loại A còn chờ, trong MỘT lần ghi.

    Một lần ghi thay vì n lần: mỗi lần `save_fields` tạo một version mới, nên
    chấp nhận 8 đề xuất theo vòng lặp sẽ sinh 8 version — lịch sử không đọc được.
    """
    from app.services.review import service

    pending = list(
        db.execute(
            select(AiProposal).where(
                AiProposal.review_id == review.id,
                AiProposal.kind == "A",
                AiProposal.status == "pending",
            )
        ).scalars()
    )
    if not pending:
        raise ValidationError("Không có đề xuất nào đang chờ", code="no_pending_proposal")

    # Trùng vùng thì bản SAU thắng — nó phản ánh lượt chat mới nhất
    by_field: dict[str, AiProposal] = {}
    for p in pending:
        if p.field_id:
            by_field[p.field_id] = p

    service.save_fields(
        db,
        principal,
        review,
        [FieldChange(perm_id=k, value=v.proposed_text) for k, v in by_field.items()],
    )
    for p in pending:
        p.status = "accepted"
    db.flush()
    return review


__all__ = ["accept_all", "decide_proposal", "send", "undo_all"]
