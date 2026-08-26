"""
Comment theo đoạn/field — TH1 của Blueprint (mục VI.3.3.8).

## Vì sao DB là nguồn sự thật

Blueprint để ngỏ PA-A (snapshot trong DB) và PA-B (ghi `w:comment` vào `.docx`).
Chọn **PA-A luôn bật**, PA-B chỉ là tính năng xuất bản về sau. Lý do: file có
thể bị **thay thế hoàn toàn** ở PT3 (Purchasing tải về, sửa bằng Word, upload
lại). Nếu comment chỉ sống trong file thì mỗi lần reupload là mất sạch thảo luận
của người duyệt — thứ mà chính họ dựa vào để quyết định.

## Anchor phải sống sót qua các vòng sửa

Hai loại neo, chọn theo chỗ được comment:

  `field`     — vùng mở, neo bằng `perm_id`. Bền nhất: perm id do template cấp
                và giữ nguyên qua mọi lần ghi của hệ thống.
  `paragraph` — vùng khoá, neo bằng `para_id` (`w14:paraId`, đo được 197/197
                sống sót qua round-trip Word) **cộng** `text_sha256` của đoạn.

Hash để làm gì: `para_id` còn đó nhưng nội dung đã đổi thì comment không còn
đúng ngữ cảnh nữa. Khi đó đánh `orphaned` chứ không im lặng gắn vào đoạn mới —
người duyệt phải biết là bình luận của mình đã mất chỗ dựa.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import TimestampMixin, UuidPkMixin


class CommentThread(UuidPkMixin, TimestampMixin, Base):
    __tablename__ = "comment_threads"
    __table_args__ = (
        Index("ix_comment_threads_review_status", "review_id", "status"),
        Index("ix_comment_threads_anchor", "review_id", "perm_id", "para_id"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    # Version lúc tạo comment — để biết bình luận nói về bản nào
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    anchor_kind: Mapped[str] = mapped_column(String(16), nullable=False)  # field | paragraph
    perm_id: Mapped[str | None] = mapped_column(String(64))
    para_id: Mapped[str | None] = mapped_column(String(32))
    text_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Trích dẫn đoạn được comment, giữ nguyên tại thời điểm tạo. Cần cho hai
    # việc: hiện thảo luận khi anchor đã mồ côi, và cho người đọc thấy bình luận
    # nói về câu chữ nào.
    quoted_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Số điều khoản do Word sinh (`Điều 4.`) — không có trong luồng text (bẫy F5)
    citation: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="open"
    )  # open | resolved | orphaned

    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    author_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    author_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # Vì sao mồ côi — nói rõ để người duyệt biết chuyện gì đã xảy ra
    orphan_reason: Mapped[str | None] = mapped_column(String(200))


class CommentReply(UuidPkMixin, Base):
    """
    Một lượt trong thread. **Không sửa, không xoá** — thảo luận giữa Purchasing
    và người duyệt là chứng cứ của quyết định phê duyệt.
    """

    __tablename__ = "comment_replies"
    __table_args__ = (Index("ix_comment_replies_thread", "thread_id", "created_at"),)

    thread_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("comment_threads.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    author_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    author_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
