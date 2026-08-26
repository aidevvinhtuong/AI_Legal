"""Phân biệt lượt chat thật với câu từ chối do hệ thống sinh

Câu từ chối (chặn trước khi gọi LLM) vẫn phải hiện trong khung chat cho người
dùng đọc, nhưng KHÔNG được nằm trong ngữ cảnh gửi model: model thấy vài lượt
"không xác định được vùng nào" liền phía trên rồi nhại lại y hệt thay vì làm
việc. Đo được trên máy dev.

Revision ID: e7a2c9b41f08
Revises: d5ea11c07b33
Create Date: 2026-08-24 17:30:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "e7a2c9b41f08"
down_revision: str | None = "d5ea11c07b33"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("kind", sa.String(16), nullable=False, server_default="text"),
    )


def downgrade() -> None:
    op.drop_column("chat_messages", "kind")
