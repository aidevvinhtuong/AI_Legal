"""
Đề xuất sửa dạng track changes của người duyệt — TH2 của Blueprint.

## Vì sao là bảng riêng, không dùng lại `ai_proposals`

Blueprint yêu cầu diff của Manager/Legal phải **tách lớp** với diff của AI. Hai
lớp này khác nhau về bản chất: đề xuất của AI là kết quả một lần chạy model,
truy vết về `ai_runs`; đề xuất của người duyệt là **ý chí của một con người có
thẩm quyền**, phải giữ danh tính và thời điểm. Trộn vào một bảng thì mất khả
năng trả lời câu hỏi "ai đề xuất câu này" — mà đó chính là câu hỏi của audit.

## `perm_id` do SERVER giải, không nhận từ trình duyệt

FE chỉ gửi `para_id` (đọc từ `w14:paraId` mà SuperDoc giữ lại). Việc đoạn đó
nằm trong vùng mở nào, hay nằm trong vùng KHOÁ, do backend tra `document_fields`
mà quyết định. Trình duyệt không được phép tự khai mình đang sửa vùng mở — đó
đúng là con đường bypass mà ràng buộc C-3 phải chặn.

## Đề xuất nhắm vào vùng khoá KHÔNG bị vứt đi

`target = "locked"` thì đề xuất vẫn được lưu, vẫn hiện lên, chỉ là không áp
được. Đây là đường escalate cho khoảng trống nghiệp vụ F6: hợp đồng THACO có
người duyệt thật đề nghị thay văn bản Điều 3.5 — nằm trọn trong vùng khoá. Vứt
yêu cầu đó đi là làm mất một quyết định của người có thẩm quyền.
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
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import TimestampMixin, UuidPkMixin

# Loại thay đổi, ánh xạ từ mark của SuperDoc
KIND_INSERT = "insert"
KIND_DELETE = "delete"
KIND_REPLACE = "replace"
KIND_FORMAT = "format"

TARGET_OPEN = "open"
TARGET_LOCKED = "locked"

STATUS_PENDING = "pending"
STATUS_APPLIED = "applied"
STATUS_REJECTED = "rejected"
STATUS_ORPHANED = "orphaned"


class LegalEdit(UuidPkMixin, TimestampMixin, Base):
    __tablename__ = "legal_edits"
    __table_args__ = (
        Index("ix_legal_edits_review_status", "review_id", "status"),
        # Chỉ MỘT đề xuất đang treo cho mỗi (đoạn × người đề xuất): bấm "Gửi đề
        # xuất" hai lần thì lần sau ghi đè, không nhân đôi.
        #
        # Cố ý là partial index chứ không phải UNIQUE thường: đề xuất đã áp / đã
        # bỏ phải nằm NGOÀI ràng buộc, vì vòng review sau người duyệt hoàn toàn
        # có thể góp ý lại chính đoạn đó.
        Index(
            "uq_legal_edits_pending",
            "review_id",
            "change_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    # Id của mark bên SuperDoc (`mark.attrs.id`) — gom nhiều mark rời của cùng
    # một thao tác sửa về một đề xuất
    change_id: Mapped[str] = mapped_column(String(64), nullable=False)

    para_id: Mapped[str] = mapped_column(String(32), nullable=False)
    # Do server giải từ `para_id`. `None` = đoạn không thuộc vùng mở nào.
    perm_id: Mapped[str | None] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(16), nullable=False)  # open | locked

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    proposed_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Hash đoạn lúc đề xuất — tài liệu đổi sau đó thì đề xuất mất chỗ dựa
    text_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    citation: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    # Vì sao không áp được / vì sao mồ côi — nói thẳng thay vì để người dùng đoán
    blocked_reason: Mapped[str | None] = mapped_column(String(300))

    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    author_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    author_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    decide_note: Mapped[str | None] = mapped_column(String(300))
