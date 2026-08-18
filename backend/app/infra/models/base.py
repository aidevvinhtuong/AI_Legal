"""
Mixin dùng chung cho mọi bảng.

Quy ước (TS-02 mục I.2):
  - Khoá chính UUID v4 sinh phía DB — không lộ số thứ tự, không đoán được id
    của người khác.
  - Thời gian `timestamptz`, luôn UTC. Không bao giờ `timestamp` trần.
  - `row_version` tăng mỗi lần UPDATE, dùng cho optimistic locking qua ETag.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, func, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column


class UuidPkMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class RowVersionMixin:
    """
    Optimistic locking. Tầng API ánh xạ sang `ETag` / `If-Match`.

    Tăng bằng trigger trong migration chứ không bằng `onupdate` của SQLAlchemy:
    trigger đúng cả khi có ai đó UPDATE thẳng bằng SQL.
    """

    row_version: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("1"))
