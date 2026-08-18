"""
Transactional outbox cho FPT.eContract + nhật ký callback.

## Vì sao phải có outbox

Người tạo bấm Submit trên `/design-markers`. Hai việc phải xảy ra: đổi trạng
thái ticket (DB) và gọi FPT (mạng). Làm cả hai trong một request là chọn giữa
hai kiểu hỏng, kiểu nào cũng tệ:

  - gọi FPT trước rồi commit DB hỏng ⇒ hợp đồng đã sang FPT mà hệ thống không
    biết, lần Submit sau tạo envelope thứ hai;
  - commit DB trước rồi gọi FPT hỏng ⇒ ticket báo "đang đồng bộ" vĩnh viễn.

Outbox tách hẳn hai việc: request chỉ **ghi ý định** vào bảng này trong cùng
transaction với việc đổi trạng thái. Worker đọc bảng, gọi FPT, cập nhật kết
quả. Hỏng ở đâu cũng còn nguyên bản ghi để thử lại.

## Vì sao không lưu base64 trong outbox

`payload` cố tình lưu bản ĐÃ CHE base64 hợp đồng, chỉ giữ `file_id` trỏ tới
`review_files`. File là bất biến nên payload vẫn dựng lại y hệt lúc gửi, còn DB
thì không phình vì nội dung hợp đồng — đúng phản biện quyết định D3 (TS-02
mục VII).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import TimestampMixin, UuidPkMixin


class EcontractOutbox(UuidPkMixin, TimestampMixin, Base):
    __tablename__ = "econtract_outbox"
    __table_args__ = (
        # Một ticket có đúng một ý định mỗi loại. Bấm Submit nhiều lần chỉ làm
        # mới bản ghi cũ, không tạo bản thứ hai — đây là lớp chống đẩy trùng
        # nằm ở DB, không phụ thuộc vào việc FE có chặn nút hay không.
        UniqueConstraint("review_id", "kind", name="uq_econtract_outbox_review_kind"),
        Index("ix_econtract_outbox_pending", "status", "next_attempt_at"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # create | cancel
    ref_id: Mapped[str] = mapped_column(String(64), nullable=False)  # = review.code

    # File `.docx` ĐÃ CHÈN MARKER — bản xuất bản, không phải bản gốc
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("review_files.id", ondelete="SET NULL")
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="pending"
    )  # pending | sent | failed | dead
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    envelope_id: Mapped[str | None] = mapped_column(String(120))


class EcontractEvent(UuidPkMixin, Base):
    """
    Callback nhận từ FPT — lưu nguyên trạng, không xoá.

    Đây là chứng cứ duy nhất cho câu hỏi "vì sao hợp đồng chuyển sang trạng thái
    này". Đồng thời cho phép **replay** khi callback tới trước lúc ta kịp lưu
    `envelopeId`, và cho phép phát hiện callback lặp.
    """

    __tablename__ = "econtract_events"
    __table_args__ = (
        Index("ix_econtract_events_envelope", "envelope_id", "received_at"),
        Index("ix_econtract_events_review", "review_id"),
    )

    review_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="SET NULL")
    )
    envelope_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    ref_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    env_status: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    # Chữ ký HMAC hợp lệ hay không. Callback không hợp lệ VẪN được lưu (để điều
    # tra) nhưng KHÔNG được đổi trạng thái ticket.
    signature_ok: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
