"""
Audit trail — append-only.

Quyết định D7: lưu thời gian + giá trị **cũ → mới** của mỗi thay đổi.

Bảng này có trigger chặn UPDATE và DELETE ở tầng database (migration), không chỉ
ở tầng ứng dụng. Lý do: bằng chứng chỉ có giá trị nếu người có quyền vào DB cũng
không sửa được nó bằng một câu SQL.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import UuidPkMixin


class AuditLog(UuidPkMixin, Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
        Index("ix_audit_log_at", "at"),
    )

    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Giữ cả tên lẫn id: user có thể bị xoá, bản ghi audit thì không được mất nghĩa
    actor_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    actor_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    old_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
