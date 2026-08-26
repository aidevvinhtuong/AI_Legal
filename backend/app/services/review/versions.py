"""
Xác định "version tài liệu hiện tại" của một ticket.

## Vì sao cần một hàm riêng cho việc tưởng như hiển nhiên này

Không phải version nào cũng mang tệp. Một lần **Từ chối** cũng bump version và
ghi snapshot, nhưng tài liệu không đổi nên `file_id` để `None`. Lấy đơn thuần
"version số lớn nhất" rồi đi tìm tệp của nó là ra tay trắng — và mọi thứ đọc từ
tài liệu sụp theo:

  * `save_fields()` ném `missing_file` ⇒ **Purchasing không sửa được gì sau khi
    bị Từ chối**, đúng lúc họ cần sửa nhất
  * kiểm kê `document_fields` rỗng ⇒ UI không còn trường mở nào để hiển thị
  * `comments.reanchor()` không thấy đoạn nào ⇒ đánh mồ côi TOÀN BỘ bình luận
  * đề xuất TH2 mồ côi theo

Đo được trên ticket VTS.HQP.261105: Legal Từ chối xong, `GET /reviews/{id}` trả
`fields: []`.

Nên "version hiện tại của tài liệu" phải là **version mới nhất CÓ tệp**, khác
với "version mới nhất" dùng để đánh số vòng duyệt. Hai khái niệm, hai hàm.

Sửa ở đây là lớp phòng thủ thứ hai. Lớp thứ nhất là `service.decide()` mang tệp
và kiểm kê của version trước sang version Từ chối — snapshot mà thiếu tệp thì
không còn là snapshot.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import ConflictError
from app.infra.models import ContractReview, ReviewVersion


def latest(db: Session, review: ContractReview) -> ReviewVersion:
    """Version mới nhất, kể cả version không mang tệp (Từ chối, ghi chú…)."""
    version = db.execute(
        select(ReviewVersion)
        .where(ReviewVersion.review_id == review.id)
        .order_by(ReviewVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise ConflictError("Ticket chưa có version nào", code="no_version")
    return version


def current_document(db: Session, review: ContractReview) -> ReviewVersion:
    """
    Version mang tệp `.docx` đang có hiệu lực — cái mà mọi thao tác đọc/ghi tài
    liệu phải bám vào.
    """
    version = db.execute(
        select(ReviewVersion)
        .where(ReviewVersion.review_id == review.id, ReviewVersion.file_id.isnot(None))
        .order_by(ReviewVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise ConflictError("Ticket chưa có version nào kèm tệp", code="no_document_version")
    return version


__all__ = ["current_document", "latest"]
