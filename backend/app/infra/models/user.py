"""Tài khoản và phân quyền."""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infra.db import Base
from app.infra.models.base import RowVersionMixin, TimestampMixin, UuidPkMixin


class User(UuidPkMixin, TimestampMixin, RowVersionMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    department: Mapped[str] = mapped_column(String(32), nullable=False, default="Purchasing")
    role: Mapped[str] = mapped_column(String(32), nullable=False)

    # Quyết định A5: Manager thấy ticket của user có Line Manager = mình.
    line_manager_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Quyền tick tay. Rỗng ⇒ suy ra từ role (Blueprint VI.5.2).
    permissions: Mapped[list[str]] = mapped_column(
        ARRAY(String(32)), nullable=False, server_default="{}"
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    line_manager = relationship("User", remote_side="User.id", uselist=False)
