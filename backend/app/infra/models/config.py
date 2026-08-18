"""
Cấu hình pháp lý do Legal quản trị, và bảng Phân quyền ký do IT quản trị.

Hai lớp checklist (Blueprint §3):

    parent  gắn Loại HĐ  (`documentCategories.id`, vd `hqp`)   — dùng chung
    child   gắn Tên HĐ   (`contractNames.id`, vd `cn_hqp_...`)  — overlay opt-in

AI đọc bản **gộp cha ∪ con**, cùng `clause.code` thì bản con thắng.

`clauses` để dạng JSONB thay vì bảng riêng: FE lưu nguyên cả version trong một
lần `PUT`, và ta không có nhu cầu truy vấn xuyên cấu hình theo điều khoản. Bảng
riêng sẽ tạo ra một tầng đồng bộ mà không đổi lại được gì. Đổi ý thì tách sau —
JSONB có sẵn dữ liệu để migrate.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import RowVersionMixin, TimestampMixin, UuidPkMixin


class ChecklistConfig(UuidPkMixin, TimestampMixin, RowVersionMixin, Base):
    __tablename__ = "checklist_configs"
    __table_args__ = (
        UniqueConstraint(
            "config_layer", "contract_type_id", name="uq_checklist_configs_layer_type"
        ),
        Index("ix_checklist_configs_parent", "parent_category_id"),
    )

    # slug của documentCategories (parent) hoặc contractNames (child)
    contract_type_id: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_category_id: Mapped[str] = mapped_column(String(120), nullable=False)
    config_layer: Mapped[str] = mapped_column(String(8), nullable=False)  # parent | child

    label: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    group: Mapped[str] = mapped_column(String(16), nullable=False, server_default="framework")
    lifecycle: Mapped[str] = mapped_column(String(16), nullable=False, server_default="published")
    version: Mapped[int] = mapped_column(nullable=False, server_default="1")

    require_template_match: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    template_file_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    approval_matrix_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # [{code, name, kind, severity, standardText, fallback, redLine, ...}]
    clauses: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    ai_tiers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default='{"ruleBasedEnabled": true, "semanticEnabled": true}'
    )

    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")
    created_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    updated_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")


class SigningAuthorityRule(UuidPkMixin, TimestampMixin, Base):
    """
    Một dòng bảng Phân quyền ký (Blueprint §4.3.2).

        Công ty (nhiều) × Loại HĐ × [min, max] giá trị → người + quyền ký

    KHÔNG thay luồng duyệt nội bộ Manager → Legal. Nó chỉ quyết định ai được
    đẩy sang eContract ở phía bên mua.
    """

    __tablename__ = "signing_authority_rules"
    __table_args__ = (Index("ix_signing_rules_category", "document_category_id"),)

    business_entity_ids: Mapped[list[str]] = mapped_column(
        ARRAY(String(120)), nullable=False, server_default="{}"
    )
    document_category_id: Mapped[str] = mapped_column(String(120), nullable=False)

    # Dùng numeric chứ không float: đây là tiền, so sánh biên phải chính xác
    min_value: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, server_default="0")
    max_value: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)

    ec_role: Mapped[str] = mapped_column(String(16), nullable=False)  # reviewer | signer
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    personal_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    telephone_number: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    sign_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    sort_order: Mapped[int] = mapped_column(nullable=False, server_default="0")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
