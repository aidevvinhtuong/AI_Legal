"""B3: comment thread 2 chiều (TH1)

Nguồn sự thật là DB, không phải file: PT3 cho phép Purchasing thay thế hoàn toàn
tệp `.docx`, nên comment sống trong file sẽ mất sạch sau mỗi lần reupload.

`comment_replies` là append-only — thảo luận giữa Purchasing và người duyệt là
chứng cứ của quyết định phê duyệt, không được sửa lại sau.

Revision ID: d5ea11c07b33
Revises: c4df88a01e12
Create Date: 2026-08-24 15:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d5ea11c07b33"
down_revision: str | None = "c4df88a01e12"
branch_labels: str | None = None
depends_on: str | None = None


def _pk() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


def upgrade() -> None:
    op.create_table(
        "comment_threads",
        _pk(),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "review_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contract_reviews.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_no", sa.Integer, nullable=False, server_default="1"),
        sa.Column("anchor_kind", sa.String(16), nullable=False),
        sa.Column("perm_id", sa.String(64)),
        sa.Column("para_id", sa.String(32)),
        sa.Column("text_sha256", sa.String(64), nullable=False, server_default=""),
        sa.Column("ordinal", sa.Integer, nullable=False, server_default="0"),
        sa.Column("quoted_text", sa.Text, nullable=False, server_default=""),
        sa.Column("citation", sa.String(120), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column(
            "author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("author_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(32), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("orphan_reason", sa.String(200)),
    )
    op.create_index(
        "ix_comment_threads_review_status", "comment_threads", ["review_id", "status"]
    )
    op.create_index(
        "ix_comment_threads_anchor", "comment_threads", ["review_id", "perm_id", "para_id"]
    )

    op.create_table(
        "comment_replies",
        _pk(),
        sa.Column(
            "thread_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("comment_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("author_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("author_role", sa.String(32), nullable=False, server_default=""),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_comment_replies_thread", "comment_replies", ["thread_id", "created_at"])

    op.execute(
        """
        CREATE TRIGGER trg_comment_replies_append_only
        BEFORE UPDATE OR DELETE ON comment_replies
        FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_comment_replies_append_only ON comment_replies")
    op.drop_index("ix_comment_replies_thread", table_name="comment_replies")
    op.drop_table("comment_replies")
    op.drop_index("ix_comment_threads_anchor", table_name="comment_threads")
    op.drop_index("ix_comment_threads_review_status", table_name="comment_threads")
    op.drop_table("comment_threads")
