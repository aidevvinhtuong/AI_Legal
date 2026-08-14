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

from fastapi import APIRouter, File, Form, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, assert_fresh, etag, if_match
from app.api.presenters import review_out
from app.domain.enums import ReviewAction, ReviewKind, ReviewStatus
from app.domain.errors import NotFoundError, ValidationError
from app.infra.models import ReviewFile
from app.infra.settings import get_settings
from app.services.document.allowlist import FieldChange
from app.services.review import service
from app.services.storage.objects import get_storage

router = APIRouter(prefix="/api/v1/reviews", tags=["reviews"])

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


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

    primary = file or (files[0] if files else None)
    if primary is None or not primary.filename:
        raise ValidationError(
            "Chưa chọn tệp hợp đồng — cần đúng 1 tệp .docx", code="file_required"
        )
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
        contract_type_id=contract_type_id or str(intake_data.get("contractNameId") or ""),
        contract_type_label=contract_type_label or str(intake_data.get("contractNameLabel") or ""),
        intake=intake_data,
        file_name=primary.filename or "contract.docx",
        blob=blob,
        kind=ReviewKind(kind) if kind in {k.value for k in ReviewKind} else ReviewKind.FULL,
        prompt=prompt,
    )

    # M1 chạy đồng bộ tầng rule-based. Vòng G4 đẩy sang Celery và trạng thái sẽ
    # đi qua queued → processing thật.
    service.run_rule_based_review(db, review)
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
    request_if_match: int | None = None,
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    assert_fresh(request_if_match, review.row_version)

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
    db.flush()
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
) -> dict[str, Any]:
    """
    **Đường ghi tài liệu duy nhất.**

    Mọi thay đổi đi qua allow-list Lớp 1 rồi hậu kiểm Lớp 2 trước khi có tệp
    mới. Yêu cầu nhắm vào vùng khoá bị từ chối kèm lý do cụ thể cho từng vùng.
    """
    review = service.get_review(db, review_id, principal)
    changes = [FieldChange(perm_id=f.id, value=f.value) for f in payload.fields]
    bundle = service.save_fields(db, principal, review, changes)
    response.headers["ETag"] = etag(bundle.review.row_version)
    return _out(db, bundle.review)


@router.post("/{review_id}/retry-ai")
def retry_ai(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    service.apply_action(db, principal, review, ReviewAction.RETRY_AI)
    service.run_rule_based_review(db, review)
    return _out(db, review)


@router.post("/{review_id}/submit")
def submit_for_approval(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Có Line Manager → hàng chờ Manager; không có → thẳng Legal."""
    review = service.get_review(db, review_id, principal)
    service.apply_action(db, principal, review, ReviewAction.SUBMIT_APPROVAL)
    return _out(db, review)


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


__all__ = ["if_match", "router"]
