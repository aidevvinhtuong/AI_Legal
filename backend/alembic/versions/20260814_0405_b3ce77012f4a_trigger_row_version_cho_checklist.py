"""trigger row_version cho checklist_configs

Bảng mới có `row_version` thì phải có trigger tương ứng, nếu không optimistic
locking im lặng không hoạt động — nguy hiểm hơn là không có, vì tưởng là có.

Revision ID: b3ce77012f4a
Revises: a2fd89509b25
Create Date: 2026-08-14 04:05:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "b3ce77012f4a"
down_revision: str | None = "a2fd89509b25"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TRIGGER trg_checklist_configs_row_version
        BEFORE UPDATE ON checklist_configs
        FOR EACH ROW EXECUTE FUNCTION bump_row_version();
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS trg_checklist_configs_row_version ON checklist_configs;"
    )
