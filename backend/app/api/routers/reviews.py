"""
Vòng đời hợp đồng — nhóm endpoint chính của FE.

Ba khác biệt có chủ đích so với bản FE đang gọi:

  1. **Bỏ `PATCH /reviews/{id}/document {text}`.** Nhận toàn văn bản làm payload
     là phá vỡ mô hình vùng khoá ngay từ thiết kế: không có cách nào biết phần
     nào người dùng được sửa. Thay bằng `PUT /reviews/{id}/fields`.
  2. **Bỏ `PATCH /sections/{index}`.** Định vị bằng số thứ tự đoạn không ổn định
     qua các vòng sửa. Định vị bằng `permId`.
  3. **Bỏ `POST /reviews/{id}/advance`.** Đó là mô phỏng hàng đợi của bản demo.
     Trạng thái thật đọc bằng `GET /reviews/{id}/status`.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import (
    CurrentUser,
    DbSession,
    assert_fresh,
    etag,
    fresh_row_version,
    if_match,
)
from app.api.presenters import review_out
from app.domain.enums import ReviewAction, ReviewKind, ReviewStatus
from app.domain.errors import NotFoundError, ValidationError
from app.infra.db import on_commit
from app.infra.models import ReviewFile
from app.infra.settings import get_settings
from app.services.document.allowlist import FieldChange
from app.services.review import attachments, comments, legal_edits, service
from app.services.review import chat as review_chat
from app.services.review import reupload as reupload_service
from app.services.review.ai_review import run_ai_review
from app.services.storage.objects import get_storage
from app.workers.ai_review import enqueue_review

router = APIRouter(prefix="/api/v1/reviews", tags=["reviews"])

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _start_ai(db, review) -> None:
    """
    Khởi động AI review.

    Đẩy job phải chờ **sau khi commit**: worker nhận job trong vài mili-giây và
    sẽ không thấy ticket nếu transaction chưa xong. Redis chết thì job không
    vào được hàng đợi, nhưng ticket vẫn nằm ở `queued` và task định kỳ
    `ai.drain` sẽ vớt — không chặn request để chạy đồng bộ vài phút.
    """
    if get_settings().AI_RUN_INLINE:
        run_ai_review(db, review)
        return
    review_id, version = str(review.id), review.version
    on_commit(db, lambda: enqueue_review(review_id, version))


def _out(db, review) -> dict[str, Any]:
    bundle = service.load_bundle(db, review)
    payload = review_out(
        bundle.review,
        owner=bundle.owner,
        fields=bundle.fields,
        proposals=bundle.proposals,
        messages=bundle.messages,
        findings=bundle.findings,
        feedback=bundle.feedback,
        versions=bundle.versions,
        files=bundle.files,
        attached_files=bundle.attached_files,
    )
    payload["queuePosition"] = service.queue_position(db, review)
    return payload


@router.get("")
def list_reviews(principal: CurrentUser, db: DbSession) -> list[dict[str, Any]]:
    """
    Danh sách theo phạm vi của người gọi (A5).

    Trả bản rút gọn — danh sách không cần `fields`/`proposals`/`messages`, và
    tải chúng cho vài trăm ticket là lãng phí.
    """
    rows = service.list_reviews(db, principal)
    return [
        {
            "id": str(review.id),
            "documentId": review.document_id,
            "code": review.code,
            "title": review.title,
            "contractTypeId": review.contract_type_id,
            "contractTypeLabel": review.contract_type_label,
            "group": review.group,
            "status": review.status,
            "kind": review.kind,
            "ownerId": str(review.owner_id),
            "ownerName": (owner.full_name or owner.username) if owner else "",
            "version": review.version,
            "confidence": float(review.confidence),
            "createdAt": review.created_at.isoformat(),
            "updatedAt": review.updated_at.isoformat(),
            "intake": review.intake or {},
        }
        for review, owner in rows
    ]


@router.post("", status_code=201)
def create_review(
    principal: CurrentUser,
    db: DbSession,
    title: str = Form(""),
    contract_type_id: str = Form(""),
    contract_type_label: str = Form(""),
    kind: str = Form("full"),
    prompt: str = Form(""),
    intake: str = Form("{}"),
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    reference_files: list[UploadFile] | None = File(None),
    from_template: bool = Form(False),
) -> dict[str, Any]:
    """
    Tạo ticket từ file `.docx`.

    Dùng chung cho cả luồng «Tạo tài liệu» (`kind=full`) và «Review hợp đồng»
    (`kind=quick`). Cờ `kind` tường minh chứ không suy đoán từ dữ liệu — ticket
    quick bị chặn ở mọi bước sau `reviewed` (Blueprint §1.3.7).

    Nhận cả hai tên trường: `files` (FE đang gửi) và `file` (số ít, tự nhiên hơn
    khi gọi bằng curl/Postman). `reference_files` được chấp nhận nhưng CHƯA lưu —
    Blueprint chốt đúng một file chính cho AI review.
    """
    try:
        intake_data = json.loads(intake or "{}")
    except json.JSONDecodeError as e:
        raise ValidationError("Trường intake không phải JSON hợp lệ") from e
    if not isinstance(intake_data, dict):
        raise ValidationError("Trường intake phải là một object")

    # Khoá checklist AI và khoá template đều là **slug của Tên hợp đồng**
    # (`contractNames`), không phải "Loại giá trị hợp đồng" (`contractTypes`).
    #
    # Ưu tiên `intake.contractNameId` chứ không phải form field `contract_type_id`:
    # form «Tạo tài liệu» của FE đang gửi `ct_standard` vào ô đó, nên ticket tạo
    # qua UI bị tra checklist bằng `ct_standard` — không khớp gì, và AI chạy với
    # checklist RỖNG mà không ai biết. Đo được: 2 ticket trong DB dev bị vậy.
    resolved_type = str(intake_data.get("contractNameId") or "") or contract_type_id
    resolved_label = str(intake_data.get("contractNameLabel") or "") or contract_type_label

    # ── Đường CHÍNH: sinh tài liệu từ template Legal đã đăng ký ────────────
    # Không nhận file từ người dùng, nên kiểm kê vùng mở/khoá tin cậy tuyệt đối
    # (CLAUDE.md 5.1). Đường upload bên dưới là đường phụ, phải qua binding.
    if from_template:
        if not resolved_type:
            raise ValidationError(
                "Phải chọn Tên hợp đồng để biết lấy template nào",
                code="contract_name_required",
            )
        review = service.create_review(
            db,
            principal,
            title=title,
            contract_type_id=resolved_type,
            contract_type_label=resolved_label,
            intake=intake_data,
            kind=ReviewKind(kind) if kind in {k.value for k in ReviewKind} else ReviewKind.FULL,
            prompt=prompt,
            from_template=True,
        )
        _start_ai(db, review)
        return _out(db, review)

    primary = file or (files[0] if files else None)
    if primary is None or not primary.filename:
        raise ValidationError("Chưa chọn tệp hợp đồng — cần đúng 1 tệp .docx", code="file_required")
    if reference_files:
        # Không im lặng bỏ qua: nói rõ để người dùng không tưởng đã đính kèm được
        raise ValidationError(
            "Sprint 1 chỉ nhận đúng 1 tệp hợp đồng chính, chưa hỗ trợ tệp tham chiếu",
            code="reference_files_unsupported",
        )

    settings = get_settings()
    blob = primary.file.read()
    if len(blob) > settings.MAX_UPLOAD_BYTES:
        raise ValidationError(
            f"Tệp vượt quá {settings.MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
            code="file_too_large",
        )

    review = service.create_review(
        db,
        principal,
        title=title,
        contract_type_id=resolved_type,
        contract_type_label=resolved_label,
        intake=intake_data,
        file_name=primary.filename or "contract.docx",
        blob=blob,
        kind=ReviewKind(kind) if kind in {k.value for k in ReviewKind} else ReviewKind.FULL,
        prompt=prompt,
    )

    # Đẩy vào hàng đợi rồi trả ngay: AI review đo thực tế mất 38s với checklist
    # 4 điều khoản, checklist thật sẽ là vài phút — không request nào chờ nổi.
    # Hàng đợi chết thì chạy đồng bộ để không chặn người dùng (có thể chậm).
    _start_ai(db, review)
    return _out(db, review)


@router.get("/{review_id}")
def get_review(review_id: uuid.UUID, principal: CurrentUser, db: DbSession, response: Response):
    review = service.get_review(db, review_id, principal)
    response.headers["ETag"] = etag(review.row_version)
    return _out(db, review)


@router.get("/{review_id}/status")
def review_status(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """Poll nhẹ cho màn hàng đợi. Vòng sau thay bằng SSE."""
    review = service.get_review(db, review_id, principal)
    return {
        "id": str(review.id),
        "status": review.status,
        "version": review.version,
        "queuePosition": service.queue_position(db, review),
        "confidence": float(review.confidence),
        "failureReason": review.failure_reason,
        "allowedActions": service.available_actions(db, review, principal),
        "updatedAt": review.updated_at.isoformat(),
    }


class IntakeIn(BaseModel):
    intake: dict[str, Any] = Field(default_factory=dict)
    contractTypeId: str | None = None  # noqa: N815
    contractTypeLabel: str | None = None  # noqa: N815
    prompt: str | None = None
    title: str | None = None


@router.patch("/{review_id}/intake")
def update_intake(
    review_id: uuid.UUID,
    payload: IntakeIn,
    principal: CurrentUser,
    db: DbSession,
    response: Response,
    # PHẢI là `Depends(if_match)`. Khai trần `int | None = None` thì FastAPI coi
    # đây là **query param** `?request_if_match=`, header `If-Match` không bao
    # giờ được đọc, và kiểm phiên bản im lặng không chạy.
    expected_version: int | None = Depends(if_match),
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    assert_fresh(expected_version, review.row_version)

    if ReviewStatus(review.status).blocks_document_write:
        from app.domain.errors import LockedError

        raise LockedError(
            f"Không sửa được thông tin khi ticket đang ở trạng thái “{review.status}”"
        )

    review.intake = {**(review.intake or {}), **payload.intake}
    if payload.contractTypeId is not None:
        review.contract_type_id = payload.contractTypeId
    if payload.contractTypeLabel is not None:
        review.contract_type_label = payload.contractTypeLabel
    if payload.prompt is not None:
        review.prompt = payload.prompt
    if payload.title:
        review.title = payload.title
    response.headers["ETag"] = etag(fresh_row_version(db, review))
    return _out(db, review)


class FieldIn(BaseModel):
    id: str = Field(min_length=1)  # permId
    value: str | list[str]


class FieldsIn(BaseModel):
    fields: list[FieldIn]


@router.put("/{review_id}/fields")
def save_fields(
    review_id: uuid.UUID,
    payload: FieldsIn,
    principal: CurrentUser,
    db: DbSession,
    response: Response,
    expected_version: int | None = Depends(if_match),
) -> dict[str, Any]:
    """
    **Đường ghi tài liệu duy nhất.**

    Mọi thay đổi đi qua allow-list Lớp 1 rồi hậu kiểm Lớp 2 trước khi có tệp
    mới. Yêu cầu nhắm vào vùng khoá bị từ chối kèm lý do cụ thể cho từng vùng.
    """
    review = service.get_review(db, review_id, principal)
    assert_fresh(expected_version, review.row_version)
    changes = [FieldChange(perm_id=f.id, value=f.value) for f in payload.fields]
    bundle = service.save_fields(db, principal, review, changes)
    response.headers["ETag"] = etag(fresh_row_version(db, bundle.review))
    return _out(db, bundle.review)


class ChatIn(BaseModel):
    content: str = Field(min_length=1)


@router.post("/{review_id}/chat")
def chat(
    review_id: uuid.UUID, payload: ChatIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Chat sửa văn bản (PT1) — phương thức chỉnh sửa mặc định.

    Chạy **đồng bộ**, không qua hàng đợi: NFR cho phép 30s/lượt chat và chỉ có
    đúng một lần gọi LLM, khác hẳn AI review (27s vì gọi mỗi điều khoản một lần).

    Yêu cầu nhắm ra ngoài vùng mở bị **từ chối trước khi gọi LLM** — xem
    `services/ai/chat.py`. Chat chỉ sinh đề xuất; áp dụng thì đi qua đường ghi
    duy nhất `PUT /reviews/{id}/fields`.
    """
    review = service.get_review(db, review_id, principal)
    review_chat.send(db, principal, review, payload.content)
    return _out(db, review)


class ProposalDecisionIn(BaseModel):
    """
    `undone` = hoàn tác đề xuất đã áp dụng bằng cách **ghi lại giá trị cũ**,
    không phải xoá version — `review_versions` là snapshot bất biến.
    """

    status: str = Field(pattern="^(accepted|rejected|undone)$")


@router.post("/{review_id}/proposals/undo-all")
def undo_all_proposals(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Hoàn tác mọi đề xuất đã áp dụng mà vùng chưa bị sửa tiếp, trong MỘT version."""
    review = service.get_review(db, review_id, principal)
    review_chat.undo_all(db, principal, review)
    return _out(db, review)


@router.post("/{review_id}/proposals/accept-all")
def accept_all_proposals(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Áp mọi đề xuất Loại A còn chờ trong MỘT version, không phải n version."""
    review = service.get_review(db, review_id, principal)
    review_chat.accept_all(db, principal, review)
    return _out(db, review)


@router.post("/{review_id}/proposals/{proposal_id}")
def decide_proposal(
    review_id: uuid.UUID,
    proposal_id: uuid.UUID,
    payload: ProposalDecisionIn,
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    review_chat.decide_proposal(db, principal, review, proposal_id, payload.status)
    return _out(db, review)


@router.post("/{review_id}/retry-ai")
def retry_ai(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    service.apply_action(db, principal, review, ReviewAction.RETRY_AI)
    _start_ai(db, review)
    return _out(db, review)


@router.post("/{review_id}/submit")
def submit_for_approval(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Có Line Manager → hàng chờ Manager; không có → thẳng Legal."""
    review = service.get_review(db, review_id, principal)
    service.apply_action(db, principal, review, ReviewAction.SUBMIT_APPROVAL)
    return _out(db, review)


class DecisionIn(BaseModel):
    """
    A4b: không có "sửa/comment yêu cầu chỉnh + Approve". Từ chối thì bắt buộc
    nói lý do; duyệt thì comment chỉ là ghi chú.
    """

    decision: str = Field(pattern="^(approve|reject)$")
    comment: str = ""
    feedback: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/{review_id}/manager-decide")
def manager_decide(
    review_id: uuid.UUID, payload: DecisionIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Purchasing Manager duyệt. Approve → hàng chờ Legal (KHÔNG gọi eContract)."""
    review = service.get_review(db, review_id, principal)
    service.decide(
        db,
        principal,
        review,
        stage="manager",
        approve=payload.decision == "approve",
        comment=payload.comment,
        feedback=payload.feedback,
    )
    return _out(db, review)


@router.post("/{review_id}/legal-decision")
def legal_decision(
    review_id: uuid.UUID, payload: DecisionIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Legal duyệt.

    Approve → `pending_markers` và **resolve người ký bên mua** từ bảng Phân
    quyền ký. Vẫn CHƯA gọi FPT: người tạo phải hoàn tất wizard marker rồi mới
    đẩy (Blueprint v1.24).
    """
    review = service.get_review(db, review_id, principal)
    service.decide(
        db,
        principal,
        review,
        stage="legal",
        approve=payload.decision == "approve",
        comment=payload.comment,
        feedback=payload.feedback,
    )
    return _out(db, review)


@router.get("/{review_id}/signing-flow")
def signing_flow(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """Xem trước ai sẽ ký — và vì sao Legal chưa duyệt được, nếu chưa sẵn sàng."""
    review = service.get_review(db, review_id, principal)
    return service.preview_signing_flow(db, review)


@router.get("/{review_id}/files/{kind}")
def download_file(
    review_id: uuid.UUID,
    kind: str,
    principal: CurrentUser,
    db: DbSession,
):
    """
    Tải tệp qua endpoint kiểm quyền, KHÔNG phải presigned URL trần.

    FE nhúng link này vào preview; presigned URL lọt ra ngoài phiên là ai cũng
    tải được trong thời gian còn hiệu lực.
    """
    review = service.get_review(db, review_id, principal)
    bundle = service.load_bundle(db, review)

    file_row: ReviewFile | None = bundle.files.get(kind)
    if file_row is None and kind == "reviewed":
        file_row = bundle.files.get("original")
    if file_row is None:
        raise NotFoundError("Tệp")

    data = get_storage().get(file_row.storage_key)
    return StreamingResponse(
        iter([data]),
        media_type=file_row.content_type or DOCX_MIME,
        headers={
            "Content-Disposition": f'attachment; filename="{review.code}.docx"',
            "Content-Length": str(len(data)),
            "X-Content-Sha256": file_row.sha256,
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# TH3 — người duyệt đính kèm tệp đã sửa vào lượt Từ chối
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/{review_id}/attachments")
def list_attachments(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> list[dict[str, Any]]:
    review = service.get_review(db, review_id, principal)
    return attachments.list_for(db, principal, review)


@router.post("/{review_id}/attachments", status_code=201)
async def add_attachment(
    review_id: uuid.UUID,
    principal: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
    note: str = Form(""),
) -> dict[str, Any]:
    """
    Lưu **nội dung thật** của tệp đính kèm.

    Khác `POST /reupload`: đây là vật chứng đi kèm một ý kiến, KHÔNG thay tài
    liệu, không bump version, không chạy lại AI, và **không** đối chiếu cấu trúc
    — người duyệt có quyền đề nghị sửa cả vùng khoá.
    """
    review = service.get_review(db, review_id, principal)
    if not file.filename:
        raise ValidationError("Chưa chọn tệp", code="file_required")

    row = attachments.add(
        db,
        principal,
        review,
        file_name=file.filename,
        blob=await file.read(),
        content_type=file.content_type or "",
        note=note,
    )
    return attachments.out(review, row)


@router.get("/{review_id}/attachments/{attachment_id}")
def download_attachment(
    review_id: uuid.UUID,
    attachment_id: uuid.UUID,
    principal: CurrentUser,
    db: DbSession,
):
    """
    Tải một tệp đính kèm. Đi qua endpoint kiểm quyền như mọi tệp khác.

    `Content-Disposition` giữ **tên gốc** người duyệt đặt — họ thường đặt tên có
    nghĩa ("HD dich vu - Legal sua dieu 4.docx"), và đổi tên là làm mất thông tin.
    """
    review = service.get_review(db, review_id, principal)
    row = attachments.get(db, principal, review, attachment_id)
    data = get_storage().get(row.storage_key)
    return StreamingResponse(
        iter([data]),
        media_type=row.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{row.file_name}"',
            "Content-Length": str(len(data)),
            "X-Content-Sha256": row.sha256,
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# PT3 — tải về sửa bằng Word rồi upload lại
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/{review_id}/reupload")
async def reupload_document(
    review_id: uuid.UUID,
    principal: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
    note: str = Form(""),
) -> dict[str, Any]:
    """
    Nhận tệp đã sửa ngoài hệ thống. **Không có tham số bỏ qua kiểm tra.**

    Lệch cấu trúc → `422 reupload_rejected` kèm `issues[]` đúng hình dạng
    `FieldStructureIssue[]` mà FE đã có component hiển thị. Đó là ràng buộc C-4:
    chặn hoàn toàn, không override, không phân quyền nào mở được.

    Thành công thì đây là **vòng review mới**: version tăng, kết quả AI cũ bị
    xoá (chúng nói về một tệp không còn tồn tại), và AI chạy lại từ đầu.
    """
    review = service.get_review(db, review_id, principal)
    if not file.filename:
        raise ValidationError("Chưa chọn tệp .docx", code="file_required")

    reupload_service.reupload(
        db,
        principal,
        review,
        file_name=file.filename,
        blob=await file.read(),
        note=note,
    )
    _start_ai(db, review)
    return _out(db, review)


# ─────────────────────────────────────────────────────────────────────────────
# Comment 2 chiều (TH1)
# ─────────────────────────────────────────────────────────────────────────────
class CommentIn(BaseModel):
    """
    Neo bằng `permId` (vùng mở) HOẶC `paraId` (đoạn bất kỳ, kể cả vùng khoá).

    Vùng khoá vẫn comment được — đó chính là ca thật đã thấy trong hợp đồng
    THACO: người duyệt yêu cầu sửa Điều 3.5 và 3.6, cả hai nằm trọn trong vùng
    khoá. Hệ thống không ghi được vào đó, nhưng phải ghi nhận được yêu cầu.
    """

    permId: str | None = None  # noqa: N815
    paraId: str | None = None  # noqa: N815
    content: str = Field(min_length=1)


class ReplyIn(BaseModel):
    content: str = Field(min_length=1)


@router.get("/{review_id}/comments")
def list_comments(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> list[dict[str, Any]]:
    """
    Thread kèm toàn bộ lượt trả lời.

    Tái neo chạy ở ĐÂY, lúc đọc: tài liệu đổi được từ nhiều đường (ghi trường,
    chat, reupload PT3) và nhớ gọi ở tất cả các đường là điều sớm muộn sẽ quên.
    """
    review = service.get_review(db, review_id, principal)
    return comments.list_threads(db, principal, review)


@router.post("/{review_id}/comments", status_code=201)
def create_comment(
    review_id: uuid.UUID, payload: CommentIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    thread = comments.create_thread(
        db,
        principal,
        review,
        perm_id=payload.permId,
        para_id=payload.paraId,
        content=payload.content,
    )
    return next(
        t for t in comments.list_threads(db, principal, review) if t["id"] == str(thread.id)
    )


@router.post("/{review_id}/comments/{thread_id}/replies", status_code=201)
def reply_comment(
    review_id: uuid.UUID,
    thread_id: uuid.UUID,
    payload: ReplyIn,
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    comments.reply(db, principal, review, thread_id, payload.content)
    return next(
        t for t in comments.list_threads(db, principal, review) if t["id"] == str(thread_id)
    )


@router.post("/{review_id}/comments/{thread_id}/resolve")
def resolve_comment(
    review_id: uuid.UUID, thread_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Đóng thread. **KHÔNG** đổi trạng thái ticket — quy tắc A4b: yêu cầu chỉnh
    sửa phải kết thúc bằng Từ chối, không phải bằng việc đóng bình luận.
    """
    review = service.get_review(db, review_id, principal)
    comments.resolve(db, principal, review, thread_id)
    return next(
        t for t in comments.list_threads(db, principal, review) if t["id"] == str(thread_id)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Track changes của người duyệt (TH2)
# ─────────────────────────────────────────────────────────────────────────────
class LegalEditIn(BaseModel):
    """
    Một đề xuất đọc từ SuperDoc.

    Cố ý KHÔNG có `permId`: vùng mở nào bị chạm là kết luận của SERVER, tra từ
    `document_fields`. Cho trình duyệt tự khai vùng đích là mở đúng con đường
    bypass mà ràng buộc C-3 phải chặn.

    `before`/`after` là **toàn văn đoạn** trước và sau khi áp đề xuất — service
    tự cắt tiền tố/hậu tố chung để tìm đúng mẩu đã đổi.

    Cũng không có `changeId`: khoá định danh đề xuất là (đoạn × người đề xuất),
    do server sinh. Để client đặt là mở đường ghi đè đề xuất của người khác.
    """

    paraId: str = Field(min_length=1, max_length=32)  # noqa: N815
    kind: str = Field(pattern="^(insert|delete|replace|format)$")
    before: str = ""
    after: str = ""


class LegalEditsIn(BaseModel):
    edits: list[LegalEditIn] = Field(min_length=1)


class LegalEditDecisionIn(BaseModel):
    action: str = Field(pattern="^(apply|reject)$")
    note: str = ""


@router.get("/{review_id}/legal-edits")
def list_legal_edits(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> list[dict[str, Any]]:
    review = service.get_review(db, review_id, principal)
    return legal_edits.list_edits(db, principal, review)


@router.post("/{review_id}/legal-edits", status_code=201)
def submit_legal_edits(
    review_id: uuid.UUID, payload: LegalEditsIn, principal: CurrentUser, db: DbSession
) -> list[dict[str, Any]]:
    review = service.get_review(db, review_id, principal)
    legal_edits.submit(
        db,
        principal,
        review,
        [
            legal_edits.EditIn(
                para_id=e.paraId,
                kind=e.kind,
                before=e.before,
                after=e.after,
            )
            for e in payload.edits
        ],
    )
    return legal_edits.list_edits(db, principal, review)


@router.post("/{review_id}/legal-edits/{edit_id}/decide")
def decide_legal_edit(
    review_id: uuid.UUID,
    edit_id: uuid.UUID,
    payload: LegalEditDecisionIn,
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, Any]:
    """
    Áp hoặc bỏ một đề xuất.

    `apply` đi qua `save_fields()` — tức vẫn qua allow-list Lớp 1 và hậu kiểm
    Lớp 2. Đề xuất nhắm vào vùng khoá trả 409 kèm lý do, không có đường vòng.
    """
    review = service.get_review(db, review_id, principal)
    legal_edits.decide(db, principal, review, edit_id, payload.action, payload.note)
    # Trả cả ticket: `apply` sinh version mới nên state của FE đã cũ ngay lập tức
    return {
        "edits": legal_edits.list_edits(db, principal, review),
        "review": _out(db, review),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Realtime
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/{review_id}/events")
def review_events(review_id: uuid.UUID, principal: CurrentUser, db: DbSession):
    """
    SSE — đẩy trạng thái ticket khi có thay đổi, thay cho polling.

    Vì sao poll DB bên trong thay vì Redis pub/sub: tải của hệ thống là ≥50
    HĐ/ngày (NFR-P1), tức vài kết nối cùng lúc. Một `SELECT` mỗi giây trên khoá
    chính rẻ hơn nhiều so với chi phí vận hành thêm một kênh pub/sub — và nó
    đúng cả khi worker ghi trạng thái từ tiến trình khác.

    Ba điểm bắt buộc:
      - kiểm quyền NGAY, trước khi mở stream (không phải trong vòng lặp);
      - có heartbeat, nếu không proxy sẽ cắt kết nối đang im lặng;
      - xác thực bằng **header** như mọi endpoint khác. FE dùng `fetch` +
        `ReadableStream` chứ không `EventSource`, cố ý: `EventSource` không gửi
        được header nên token phải vào query string, và token trong URL thì rơi
        vào access log của proxy lẫn history trình duyệt.
    """
    service.get_review(db, review_id, principal)  # 403/404 ngay tại đây
    del db  # session của request không dùng trong vòng lặp — mỗi nhịp mở riêng

    return StreamingResponse(
        _status_stream(review_id, principal),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Nginx buffer response là SSE mất tác dụng hoàn toàn
            "X-Accel-Buffering": "no",
        },
    )


SSE_POLL_SECONDS = 1.0
SSE_HEARTBEAT_SECONDS = 15.0
SSE_MAX_SECONDS = 900.0


def _status_stream(review_id: uuid.UUID, principal):
    """
    Sinh sự kiện `status`. Kết thúc khi ticket ở trạng thái không còn tự đổi.

    Mỗi nhịp mở session riêng rồi đóng: giữ một session suốt 15 phút sẽ chiếm
    một connection của pool và nhìn thấy snapshot cũ do transaction dài.
    """
    import json as _json
    import time as _time

    from app.domain.enums import ReviewStatus
    from app.infra.db import session_scope

    # Trạng thái do người dùng thao tác tiếp — không có gì để chờ, đóng stream
    # để trình duyệt khỏi giữ kết nối vô ích.
    settled = {
        ReviewStatus.REVIEWED.value,
        ReviewStatus.REJECTED.value,
        ReviewStatus.PENDING_MARKERS.value,
        ReviewStatus.SIGNED.value,
        ReviewStatus.FAILED.value,
        ReviewStatus.ECONTRACT_FAILED.value,
        ReviewStatus.CANCELLED.value,
    }

    started = _time.monotonic()
    last_beat = started
    last_payload: str | None = None

    while _time.monotonic() - started < SSE_MAX_SECONDS:
        try:
            with session_scope() as db:
                review = service.get_review(db, review_id, principal)
                payload = _json.dumps(
                    {
                        "id": str(review.id),
                        "status": review.status,
                        "version": review.version,
                        "queuePosition": service.queue_position(db, review),
                        "confidence": float(review.confidence),
                        "failureReason": review.failure_reason,
                        "allowedActions": service.available_actions(db, review, principal),
                        "updatedAt": review.updated_at.isoformat(),
                    },
                    ensure_ascii=False,
                )
                status = review.status
        except Exception as e:  # ticket bị xoá, DB chớp tắt — nói rồi đóng
            yield f"event: error\ndata: {_json.dumps({'message': str(e)[:200]})}\n\n"
            return

        if payload != last_payload:
            yield f"event: status\ndata: {payload}\n\n"
            last_payload = payload
            last_beat = _time.monotonic()

        if status in settled:
            yield "event: done\ndata: {}\n\n"
            return

        if _time.monotonic() - last_beat >= SSE_HEARTBEAT_SECONDS:
            yield ": heartbeat\n\n"  # comment SSE — giữ kết nối, không sinh event
            last_beat = _time.monotonic()

        _time.sleep(SSE_POLL_SECONDS)

    yield "event: timeout\ndata: {}\n\n"


__all__ = ["if_match", "router"]
