"""M4: outbox và nhật ký callback eContract

Hai bảng phục vụ tích hợp FPT.eContract:

  `econtract_outbox`  transactional outbox — request chỉ ghi ý định, worker mới
                      gọi FPT. UNIQUE (review_id, kind) là lớp chống đẩy trùng
                      nằm ở DB, không phụ thuộc FE có chặn nút hay không.
  `econtract_events`  callback nhận từ FPT, lưu nguyên trạng kể cả khi chữ ký
                      sai — đó là chứng cứ điều tra, không được xoá.

Revision ID: c4df88a01e12
Revises: b3ce77012f4a
Create Date: 2026-08-14 11:20:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4df88a01e12"
down_revision: str | None = "b3ce77012f4a"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "econtract_outbox",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "review_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contract_reviews.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("ref_id", sa.String(64), nullable=False),
        sa.Column(
            "file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("review_files.id", ondelete="SET NULL"),
        ),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text),
        sa.Column("last_error_code", sa.String(64)),
        sa.Column("envelope_id", sa.String(120)),
        sa.UniqueConstraint("review_id", "kind", name="uq_econtract_outbox_review_kind"),
    )
    op.create_index(
        "ix_econtract_outbox_pending", "econtract_outbox", ["status", "next_attempt_at"]
    )

    op.create_table(
        "econtract_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "review_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("contract_reviews.id", ondelete="SET NULL"),
        ),
        sa.Column("envelope_id", sa.String(120), nullable=False, server_default=""),
        sa.Column("ref_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("env_status", sa.String(32), nullable=False, server_default=""),
        sa.Column("payload", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("signature_ok", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("applied", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_econtract_events_envelope", "econtract_events", ["envelope_id", "received_at"]
    )
    op.create_index("ix_econtract_events_review", "econtract_events", ["review_id"])

    # Nhật ký callback là chứng cứ: không sửa, không xoá. Cùng cơ chế đã dùng
    # cho `audit_log` và `review_versions` ở migration a1b2c3d4e5f6.
    op.execute(
        """
        CREATE TRIGGER trg_econtract_events_append_only
        BEFORE UPDATE OR DELETE ON econtract_events
        FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_econtract_events_append_only ON econtract_events")
    op.drop_index("ix_econtract_events_review", table_name="econtract_events")
    op.drop_index("ix_econtract_events_envelope", table_name="econtract_events")
    op.drop_table("econtract_events")
    op.drop_index("ix_econtract_outbox_pending", table_name="econtract_outbox")
    op.drop_table("econtract_outbox")
