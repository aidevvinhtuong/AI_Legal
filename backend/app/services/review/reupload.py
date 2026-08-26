"""
PT3 — tải `.docx` về, sửa bằng Word, upload lại.

## Vì sao đây là đường nguy hiểm nhất, không phải đường tiện nhất

PT1 (chat) và PT2 (sửa inline) đều ghi qua `save_fields()`, nên allow-list Lớp 1
và hậu kiểm Lớp 2 luôn chạy trên **cùng một tệp** mà hệ thống đang giữ. PT3 thì
khác về bản chất: tệp **ra khỏi hệ thống**, đi qua Microsoft Word trên máy người
dùng, rồi quay lại như một tệp hoàn toàn mới. Không có cách nào biết trong lúc đó
họ đã làm gì — kể cả gỡ Restrict Editing rồi sửa Điều 12 về luật áp dụng.

Nên ràng buộc **C-4** nói riêng về nó: phát hiện vùng khoá bị sửa hoặc mất
`permStart` thì **chặn hoàn toàn, không có cơ chế override**. Không có tham số
`force`, không có quyền nào bỏ qua được, kể cả IT.

## Hai lớp đối chiếu, và vì sao cần cả hai

**Lớp 1 — so với chính version hiện tại của ticket.**
Dựng `TemplateBinding` từ bản kiểm kê của tệp hệ thống đang giữ, rồi `verify()`
tệp mới với nó. Dùng lại đúng bộ so sánh của structural binding, không viết logic
mới: cùng cơ chế khoá, cùng tập `permId`, cùng hash từng đoạn khoá.

Lớp này **luôn chạy được**, kể cả loại hợp đồng chưa đăng ký template. Đó là điểm
mấu chốt: `templates.bind_upload()` trả `status: "unbound"` khi chưa có template,
tức không kiểm gì cả. Nếu PT3 chỉ có lớp template thì mọi ticket của loại hợp
đồng chưa đăng ký sẽ nhận file tuỳ ý — lỗ hổng còn to hơn cái mà structural
binding sinh ra để vá.

**Lớp 2 — so với template Legal đã đăng ký.**
Bắt thêm ca "tệp gốc của ticket vốn đã lệch template" (ví dụ ticket tạo từ trước
khi Legal đăng ký template). Chạy sau Lớp 1 vì Lớp 1 cụ thể hơn về ticket này.

## Vòng review mới, không phải bản sửa

Brief chốt PT3 = **bump version + chạy lại toàn bộ AI Engine**. Không dùng lại
findings cũ, không dùng lại điểm số cũ. Lý do: chúng nói về một tệp không còn tồn
tại. Giữ lại là trưng ra kết luận AI cho một văn bản mà không ai còn đọc được.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, ReviewAction, VersionAction
from app.domain.errors import ReuploadRejectedError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import ContractReview, DocumentField, ReviewFile
from app.services.config import templates
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.structural_binding import build_binding, verify
from app.services.review import versions
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.reupload")

MAX_NOTE_CHARS = 500


def reupload(
    db: Session,
    principal: Principal,
    review: ContractReview,
    *,
    file_name: str,
    blob: bytes,
    note: str = "",
) -> ContractReview:
    """
    Nhận tệp đã sửa ngoài hệ thống, chặn nếu lệch, rồi mở vòng review mới.

    KHÔNG tự đẩy job AI — việc đánh thức worker do tầng API làm, sau `on_commit`.
    Service không biết gì về Celery (ranh giới ở `backend/CLAUDE.md` mục 2).
    """
    from app.services.review import service

    principal.require(Permission.CONTRACTS)
    if principal.user_id != review.owner_id:
        # Người duyệt muốn sửa offline thì đi đường TH3 — đính kèm tệp vào lượt
        # Từ chối. Cho họ thay thẳng tệp của ticket là bỏ qua mọi dấu vết ai đã
        # đổi cái gì, mà đây là hệ thống pháp chế.
        raise ValidationError(
            "Chỉ người tạo ticket mới upload lại được tài liệu. Người duyệt hãy "
            "đính kèm tệp đã sửa vào lượt Từ chối.",
            code="not_owner",
        )
    if not file_name.lower().endswith(".docx"):
        raise ValidationError("Chỉ nhận tệp .docx", code="invalid_file_type")

    engine = LxmlDocumentEngine()
    try:
        uploaded = engine.get_field_inventory(engine.parse(blob))
    except Exception as e:
        raise ValidationError(f"Không đọc được tệp .docx: {e}", code="invalid_docx") from e

    current_version = versions.current_document(db, review)
    current_file = db.get(ReviewFile, current_version.file_id) if current_version.file_id else None
    if current_file is None:
        raise ValidationError(
            "Ticket chưa có tệp nào để đối chiếu", code="no_current_document"
        )

    # ── Lớp 1: so với chính tệp ticket đang giữ ───────────────────────────
    labels = {
        f.perm_id: f.label
        for f in db.execute(
            select(DocumentField).where(DocumentField.version_id == current_version.id)
        ).scalars()
        if f.label
    }
    baseline = engine.get_field_inventory(engine.parse(get_storage().get(current_file.storage_key)))
    issues = verify(uploaded, build_binding(baseline, labels))
    if issues:
        _audit_rejection(db, principal, review, issues, layer="current_version")
        raise ReuploadRejectedError([i.as_payload() for i in issues], layer="current_version")

    # ── Lớp 2: so với template Legal đã đăng ký ───────────────────────────
    binding_state = templates.bind_upload(
        db, contract_name_slug=_contract_name_slug(review), inventory=uploaded
    )

    # ── Thay tệp, mở vòng mới ─────────────────────────────────────────────
    stored = get_storage().put(
        blob,
        prefix=f"reviews/{review.code}",
        file_name=file_name,
        content_type=current_file.content_type,
    )
    new_file = ReviewFile(
        review_id=review.id,
        kind="reviewed",
        file_name=file_name,
        storage_key=stored.key,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        uploaded_by=principal.user_id,
    )
    db.add(new_file)
    db.flush()

    diff = _field_diff(db, current_version.id, uploaded)

    intake = dict(review.intake or {})
    intake["structuralBinding"] = binding_state
    review.intake = intake

    service.apply_action(db, principal, review, ReviewAction.REUPLOAD)
    review.version += 1
    # Kết quả AI cũ nói về một tệp không còn tồn tại — xoá thay vì trưng ra
    _clear_ai_results(db, review)

    service.record_version(
        db,
        review=review,
        action=VersionAction.REUPLOAD,
        principal=principal,
        file=new_file,
        label=(note or "").strip()[:MAX_NOTE_CHARS] or f"Upload lại: {file_name}",
        inventory=uploaded,
        field_diff=diff,
    )
    db.flush()

    log.info(
        "%s: PT3 upload lại → version %d, %d trường đổi giá trị",
        review.code,
        review.version,
        len(diff),
    )
    return review


# ─────────────────────────────────────────────────────────────────────────────
# Phụ trợ
# ─────────────────────────────────────────────────────────────────────────────
def _contract_name_slug(review: ContractReview) -> str:
    """
    Khoá tra template. Ưu tiên `intake.contractNameId` như đường tạo ticket.

    `contract_type_id` từng là nguồn duy nhất và đã gây lỗi tra sai lớp checklist
    (`ct_standard` thay vì slug Tên HĐ) — giữ đúng một quy ước cho cả hai đường.
    """
    intake = review.intake or {}
    return str(intake.get("contractNameId") or review.contract_type_id or "")


def _field_diff(db: Session, version_id: Any, uploaded: Any) -> list[dict[str, Any]]:
    """
    Trường nào đổi giá trị so với version trước. Chỉ những vùng THẬT SỰ đổi.

    Cấu trúc đã được `verify()` bảo đảm khớp, nên so theo `permId` là an toàn.
    """
    old = {
        f.perm_id: f.value_text
        for f in db.execute(
            select(DocumentField).where(DocumentField.version_id == version_id)
        ).scalars()
    }
    out: list[dict[str, Any]] = []
    for field in sorted(uploaded.fields, key=lambda x: x.ordinal):
        before = old.get(field.perm_id, "")
        # `inner_text`, không phải `value_text`: `FieldDescriptor` (lớp tài liệu)
        # và `DocumentField` (lớp DB) đặt tên khác nhau cho cùng một thứ.
        if before != field.inner_text:
            out.append(
                {
                    "permId": field.perm_id,
                    "old": before,
                    "new": field.inner_text,
                    "mode": "reupload",
                }
            )
    return out


def _clear_ai_results(db: Session, review: ContractReview) -> None:
    """
    Bỏ findings, đề xuất và điểm số của vòng trước.

    Không phải dọn dẹp cho gọn: chúng là kết luận về một văn bản đã bị thay thế.
    Giữ lại là để người duyệt đọc "Red Flag ở điều khoản thanh toán" bên cạnh một
    điều khoản thanh toán có thể đã khác hoàn toàn.

    `ai_runs` KHÔNG xoá — đó là vết truy xuất, phải giữ để audit được (mục 6.3).
    """
    from app.infra.models import AiFinding, AiProposal

    for model in (AiFinding, AiProposal):
        for row in db.execute(select(model).where(model.review_id == review.id)).scalars():
            db.delete(row)
    review.confidence = 0
    review.fairness = 0
    review.ai_summary = ""
    db.flush()


def _audit_rejection(
    db: Session,
    principal: Principal,
    review: ContractReview,
    issues: list,
    *,
    layer: str,
) -> None:
    """
    Ghi lại mọi lần chặn. Đây là dấu hiệu có người cố sửa vùng khoá.

    Một lần có thể là vô tình (Word tự sửa gì đó). Nhiều lần trên cùng một ticket
    thì không còn là vô tình — và không ai phát hiện được nếu không ghi lại.
    """
    from app.services.review import service

    # `write_audit_now`, KHÔNG phải `write_audit`: ngay sau hàm này là một
    # `raise`, nên audit ghi vào session của request sẽ bị rollback cùng nó.
    service.write_audit_now(
        principal,
        action="reupload_rejected",
        entity_type="contract_review",
        entity_id=str(review.id),
        new_value={
            "layer": layer,
            "issueCount": len(issues),
            "types": sorted({i.type for i in issues}),
        },
    )


__all__ = ["reupload"]
