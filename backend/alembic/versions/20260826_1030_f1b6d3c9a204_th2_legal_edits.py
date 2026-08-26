"""TH2 — legal_edits: đề xuất track changes của người duyệt

Revision ID: f1b6d3c9a204
Revises: e7a2c9b41f08
Create Date: 2026-08-26 10:30:00

`perm_id` cố ý KHÔNG có foreign key sang `document_fields`: bảng đó bị dựng lại
theo từng version, còn đề xuất phải sống xuyên version để so được "đề xuất ở bản
2, áp ở bản 4". Ràng buộc thật nằm ở tầng service — nó tra lại vùng mở mỗi lần
đọc và mỗi lần áp.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "f1b6d3c9a204"
down_revision = "e7a2c9b41f08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "legal_edits",
        sa.Column(
            "id",
            PgUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "review_id",
            PgUUID(as_uuid=True),
            sa.ForeignKey("contract_reviews.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_no", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("change_id", sa.String(64), nullable=False),
        sa.Column("para_id", sa.String(32), nullable=False),
        sa.Column("perm_id", sa.String(64)),
        sa.Column("target", sa.String(16), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("original_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("proposed_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("text_sha256", sa.String(64), nullable=False, server_default=""),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("citation", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("blocked_reason", sa.String(300)),
        sa.Column(
            "author_id", PgUUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("author_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(32), nullable=False, server_default=""),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column(
            "decided_by", PgUUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("decide_note", sa.String(300)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_legal_edits_review_status", "legal_edits", ["review_id", "status"])
    # Chỉ MỘT đề xuất ĐANG TREO cho mỗi (đoạn × người đề xuất). Đề xuất đã áp
    # hoặc đã bỏ nằm ngoài ràng buộc, vì vòng review sau người duyệt hoàn toàn
    # có thể góp ý lại chính đoạn đó — chặn luôn cả lịch sử thì góp ý mới bị
    # nuốt im lặng, và người duyệt không bao giờ biết.
    op.create_index(
        "uq_legal_edits_pending",
        "legal_edits",
        ["review_id", "change_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    # `if_exists` vì bảng này từng đi qua một phiên bản trung gian không có
    # partial index — downgrade không được chết chỉ vì môi trường lệch nhau.
    op.drop_index("uq_legal_edits_pending", table_name="legal_edits", if_exists=True)
    op.drop_index("ix_legal_edits_review_status", table_name="legal_edits", if_exists=True)
    op.drop_table("legal_edits")
