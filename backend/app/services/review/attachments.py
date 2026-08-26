"""
Tệp đính kèm của một lượt duyệt — TH3.

## Vấn đề đang có

Blueprint yêu cầu (mục A4): *"file đính kèm phải lưu nội dung thật, Purchasing
tải được"*. Thực tế `FeedbackItem.attachments` là một cột JSONB nhận nguyên xi
những gì client gửi — tức chỉ `{name, size}`. Người duyệt bấm đính kèm, thấy tên
tệp hiện lên, tưởng đã gửi; Purchasing mở ra thì **không có gì để tải**. Hỏng im
lặng, đúng kiểu tệ nhất.

## TH3 khác PT3 ở chỗ nào

PT3: **chủ ticket** sửa offline rồi upload lại → tệp **thay thế** tài liệu, phải
qua hai lớp đối chiếu cấu trúc, mở vòng review mới.

TH3: **người duyệt** sửa offline rồi đính kèm vào lượt Từ chối → tệp là **vật
chứng của một ý kiến**, không phải bản mới của hợp đồng. Nên:

  * KHÔNG đối chiếu cấu trúc — người duyệt có quyền đề nghị sửa cả vùng khoá
    (khoảng trống F6 có thật), và chặn họ ở đây là làm mất ý kiến
  * KHÔNG thay tài liệu, KHÔNG bump version, KHÔNG chạy lại AI
  * Purchasing đọc nó rồi tự quyết định sửa gì qua PT1/PT2/PT3

Gộp hai đường này làm một là mất ranh giới đó, và mất luôn dấu vết ai đã đổi tệp.

## Vì sao đính kèm KHÔNG chỉ nhận `.docx`

Người duyệt gửi kèm email của khách, ảnh chụp một trang, bản PDF so sánh — đều
hợp lệ. Chặn về đúng `.docx` là bắt họ đổi định dạng cho vừa hệ thống. Cái phải
chặn là **kích thước** và **kiểu nội dung thực thi**, không phải phần mở rộng.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, ReviewStatus
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import ContractReview, ReviewFile
from app.infra.settings import get_settings
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.attachments")

KIND = "attachment"
MAX_PER_REVIEW = 20

# Đuôi tệp KHÔNG nhận. Danh sách chặn thay vì danh sách cho phép: mục đích là
# ngăn tệp thực thi được, không phải quy định người dùng gửi định dạng nào.
BLOCKED_SUFFIXES = (
    ".exe",
    ".dll",
    ".bat",
    ".cmd",
    ".com",
    ".scr",
    ".msi",
    ".ps1",
    ".sh",
    ".jar",
    ".js",
    ".vbs",
    ".hta",
)


def add(
    db: Session,
    principal: Principal,
    review: ContractReview,
    *,
    file_name: str,
    blob: bytes,
    content_type: str = "",
    note: str = "",
) -> ReviewFile:
    """
    Lưu **nội dung thật** vào object storage và ghi một `ReviewFile`.

    Không đụng tới tài liệu hợp đồng: đây là vật chứng đi kèm ý kiến, không phải
    bản mới của hợp đồng.
    """
    _assert_can_attach(principal, review)

    file_name = (file_name or "").strip()
    if not file_name:
        raise ValidationError("Tệp đính kèm thiếu tên", code="file_name_required")
    if file_name.lower().endswith(BLOCKED_SUFFIXES):
        raise ValidationError(
            "Không nhận tệp có thể thực thi được", code="executable_not_allowed"
        )
    if not blob:
        raise ValidationError("Tệp đính kèm rỗng", code="empty_file")

    limit = get_settings().MAX_UPLOAD_BYTES
    if len(blob) > limit:
        raise ValidationError(
            f"Tệp quá lớn ({len(blob) // 1024 // 1024} MB) — tối đa {limit // 1024 // 1024} MB",
            code="file_too_large",
        )

    if len(list_rows(db, review)) >= MAX_PER_REVIEW:
        raise ConflictError(
            f"Ticket đã có {MAX_PER_REVIEW} tệp đính kèm — xin gộp bớt lại",
            code="too_many_attachments",
        )

    stored = get_storage().put(
        blob,
        prefix=f"reviews/{review.code}/attachments",
        file_name=file_name,
        content_type=content_type or "application/octet-stream",
    )
    row = ReviewFile(
        review_id=review.id,
        kind=KIND,
        file_name=file_name,
        storage_key=stored.key,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        uploaded_by=principal.user_id,
    )
    db.add(row)
    db.flush()

    log.info(
        "%s: %s đính kèm “%s” (%d KB)%s",
        review.code,
        principal.username,
        file_name,
        len(blob) // 1024,
        f" — {note}" if note else "",
    )
    return row


def list_rows(db: Session, review: ContractReview) -> list[ReviewFile]:
    return list(
        db.execute(
            select(ReviewFile)
            .where(ReviewFile.review_id == review.id, ReviewFile.kind == KIND)
            .order_by(ReviewFile.created_at)
        ).scalars()
    )


def list_for(db: Session, principal: Principal, review: ContractReview) -> list[dict[str, Any]]:
    from app.services.review import service

    service.get_review(db, review.id, principal)  # ném 403/404 đúng phạm vi (A5)
    return [out(review, row) for row in list_rows(db, review)]


def get(
    db: Session, principal: Principal, review: ContractReview, attachment_id: uuid.UUID
) -> ReviewFile:
    """
    Lấy một tệp để tải. Ai đọc được ticket thì tải được đính kèm của nó.

    Không phân quyền hẹp hơn: cả mục đích của TH3 là để Purchasing đọc được thứ
    người duyệt gửi. Phạm vi ai thấy ticket nào đã do `get_review` quyết (A5).
    """
    from app.services.review import service

    service.get_review(db, review.id, principal)
    row = db.get(ReviewFile, attachment_id)
    if row is None or row.review_id != review.id or row.kind != KIND:
        raise NotFoundError("Tệp đính kèm")
    return row


def out(review: ContractReview, row: ReviewFile) -> dict[str, Any]:
    """Hình dạng cho FE. `url` đi qua endpoint kiểm quyền, không phải link trần."""
    return {
        "id": str(row.id),
        "name": row.file_name,
        "size": row.size_bytes,
        "contentType": row.content_type,
        "sha256": row.sha256,
        "uploadedAt": row.created_at.isoformat() if row.created_at else "",
        "url": f"/api/v1/reviews/{review.id}/attachments/{row.id}",
    }


def _assert_can_attach(principal: Principal, review: ContractReview) -> None:
    """
    Người duyệt **và** chủ ticket đều đính kèm được.

    Người duyệt cần cho TH3. Chủ ticket cần để trả lời — gửi lại bản đã sửa,
    biên bản họp, xác nhận của nhà cung cấp. Cấm một trong hai phía là biến
    thảo luận hai chiều thành một chiều.
    """
    from app.domain.enums import UserRole

    principal.require(Permission.CONTRACTS)
    reviewers = (UserRole.PURCHASING_MANAGER, UserRole.LEGAL, UserRole.IT)
    if principal.role not in reviewers and principal.user_id != review.owner_id:
        raise ForbiddenError("Chỉ người duyệt hoặc người tạo ticket mới đính kèm tệp được")
    if ReviewStatus(review.status).is_terminal:
        raise ConflictError(f"Ticket đã ở trạng thái cuối “{review.status}”", code="review_closed")


__all__ = ["KIND", "add", "get", "list_for", "list_rows", "out"]
