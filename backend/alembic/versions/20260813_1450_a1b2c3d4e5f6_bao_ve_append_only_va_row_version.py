"""bao ve append-only va row_version

Hai bảo vệ đặt ở tầng DATABASE, không phải tầng ứng dụng:

  1. `row_version` tự tăng mỗi lần UPDATE → optimistic locking qua ETag đúng cả
     khi có ai đó UPDATE thẳng bằng SQL.
  2. `audit_log` và `review_versions` chặn UPDATE/DELETE. Bằng chứng chỉ có giá
     trị nếu người có quyền vào DB cũng không sửa được nó bằng một câu SQL
     (quyết định D7, TS-08).

Revision ID: a1b2c3d4e5f6
Revises: 337e0b345d70
Create Date: 2026-08-13 14:50:00.000000
"""

from __future__ import annotations

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "337e0b345d70"
branch_labels: str | None = None
depends_on: str | None = None

ROW_VERSION_TABLES = ("users", "catalog_items", "contract_reviews")
APPEND_ONLY_TABLES = ("audit_log", "review_versions")


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION bump_row_version() RETURNS trigger AS $$
        BEGIN
            NEW.row_version := OLD.row_version + 1;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION
                'bang % la append-only: khong duoc UPDATE hay DELETE', TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    for table in ROW_VERSION_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_row_version
            BEFORE UPDATE ON {table}
            FOR EACH ROW EXECUTE FUNCTION bump_row_version();
            """
        )

    for table in APPEND_ONLY_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_append_only
            BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
            """
        )


def downgrade() -> None:
    for table in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table};")
    for table in ROW_VERSION_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_row_version ON {table};")
    op.execute("DROP FUNCTION IF EXISTS forbid_mutation();")
    op.execute("DROP FUNCTION IF EXISTS bump_row_version();")
