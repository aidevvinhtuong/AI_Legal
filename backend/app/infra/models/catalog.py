"""
Danh mục Form lists — nguồn của mọi dropdown trên form Tạo tài liệu.

MỘT bảng cho sáu khối thay vì sáu bảng. Lý do: chúng giống hệt nhau về vòng đời
(thêm / sửa nhãn / Lưu trữ / Xoá-nếu-chưa-dùng) và khác nhau đúng hai chỗ —
`parent_id` (Tên HĐ thuộc Loại HĐ nào) và vài cờ riêng của "Loại giá trị hợp
đồng". Sáu bảng gần trùng nhau sẽ kéo theo sáu bộ CRUD gần trùng nhau.

`kind` dùng đúng tên khối của FE (`documentCategories`, `contractNames`…) để
serialize thẳng ra `FormListsState` không cần bảng ánh xạ.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import RowVersionMixin, TimestampMixin, UuidPkMixin

CATALOG_KINDS = (
    "documentCategories",  # Loại hợp đồng (Contract category) — khoá checklist cha
    "contractNames",  # Tên hợp đồng — khoá checklist con, có parent_id
    "contractTypes",  # Loại giá trị hợp đồng
    "businessEntities",  # Công ty
    "contractBases",  # Hợp đồng tiêu chuẩn
    "discountOptions",  # Có/Không chiết khấu — chỉ sửa nhãn
)


class CatalogItem(UuidPkMixin, TimestampMixin, RowVersionMixin, Base):
    __tablename__ = "catalog_items"
    __table_args__ = (
        # `slug` là id nghiệp vụ ổn định mà FE dùng (vd `hqp`, `cn_hqp_hqp_tour`,
        # `be_vts`). Không dùng UUID làm id đối ngoại vì cấu hình checklist,
        # intake và seed đều tham chiếu bằng slug.
        UniqueConstraint("kind", "slug", name="uq_catalog_items_kind_slug"),
        Index("ix_catalog_items_kind_status", "kind", "status"),
    )

    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    label: Mapped[str] = mapped_column(String(300), nullable=False)

    # Lưu trữ thay vì xoá khi đã có giao dịch tham chiếu (Blueprint VI.4.3.1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")

    # Chỉ dùng cho `contractNames`: trỏ tới slug của documentCategories
    parent_slug: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Cờ riêng của contractTypes: group / requireTemplateMatch / hasChecklist
    attrs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

    sort_order: Mapped[int] = mapped_column(nullable=False, server_default="0")


class ContractTemplate(UuidPkMixin, TimestampMixin, Base):
    """
    Template `.docx` do Legal ban hành, kèm ảnh chụp cấu trúc để đối chiếu khi
    upload (structural binding — TS-04 mục VI).

    Không bao giờ xoá bản cũ: review đang chạy vẫn trỏ vào template version của nó.
    """

    __tablename__ = "contract_templates"
    __table_args__ = (
        Index("ix_contract_templates_scope_active", "contract_name_slug", "is_active"),
    )

    contract_name_slug: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(nullable=False, server_default="1")
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)

    mechanism: Mapped[str] = mapped_column(String(32), nullable=False)
    protection_effective: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    open_region_count: Mapped[int] = mapped_column(nullable=False, server_default="0")
    locked_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    structure_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)

    # Bản đầy đủ của TemplateBinding — regions + locked_paragraphs
    binding: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    # permId → tên nghiệp vụ do Legal khai (PH-2: permId là số ngẫu nhiên vô nghĩa)
    field_labels: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")

    is_active: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    registered_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class DocumentSequence(Base):
    """
    Bộ đếm Số tài liệu: `(Mã công ty).(Mã loại HĐ).YY + STT4` → `VTS.HQP.260001`.

    STT tăng **theo từng công ty** (Blueprint v1.12). Cấp số bằng `SELECT … FOR
    UPDATE` trên đúng một dòng nên hai request đồng thời không thể trùng số.
    """

    __tablename__ = "document_sequences"

    business_entity_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    year_yy: Mapped[str] = mapped_column(String(2), primary_key=True)
    last_value: Mapped[int] = mapped_column(nullable=False, server_default="0")
