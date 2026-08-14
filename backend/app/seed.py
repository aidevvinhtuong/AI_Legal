"""
Dữ liệu mẫu để chạy được ngay: `make seed`.

Tài khoản và danh mục lấy đúng bộ demo mà Blueprint mô tả (§1.3.1) để FE chuyển
từ mock sang API thật mà không phải đổi kịch bản thử.

Chạy được nhiều lần: đã có thì bỏ qua, không nhân đôi.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.infra.db import session_scope
from app.infra.models import CatalogItem, User
from app.services.identity.security import hash_password

USERS = [
    # username, họ tên, role, department, line manager
    ("admin", "Quản trị hệ thống", "it", "IT", None),
    ("legal", "Chuyên viên Pháp chế", "legal", "Legal", None),
    ("manager.pur", "Trưởng phòng Mua hàng", "purchasing_manager", "Purchasing", None),
    ("van.a", "Nguyễn Văn A", "purchasing", "Purchasing", "manager.pur"),
    ("thi.b", "Trần Thị B", "purchasing", "Purchasing", None),
]
PASSWORDS = {"admin": "admin"}
DEFAULT_PASSWORD = "demo123"

CATEGORIES = [
    ("hqp", "HQP", "Hàng hoá & Dịch vụ phụ trợ"),
    ("raw", "RAW", "Nguyên vật liệu"),
    ("mro", "MRO", "Bảo trì & Vận hành"),
    ("capex", "CAPEX", "Đầu tư tài sản"),
    ("log", "LOG", "Vận tải & Logistics"),
]

CONTRACT_NAMES = [
    ("hqp", "HQP_TOUR", "Tour Du lịch"),
    ("hqp", "HQP_DV", "Hợp đồng dịch vụ chung"),
    ("raw", "RAW_GYPSUM", "Mua thạch cao"),
    ("mro", "MRO_MAINT", "Bảo trì thiết bị"),
    ("capex", "CAPEX_VEHICLE", "Mua xe vận tải"),
    ("log", "LOG_INLAND", "Vận tải nội địa FCL"),
]

BUSINESS_ENTITIES = [
    ("be_sgvn", "SGVN", "Saint-Gobain Vietnam"),
    ("be_vts", "VTS", "Vinh Tuong Saint-Gobain"),
    ("be_rigips", "RIGIPS", "Rigips Vietnam"),
]

CONTRACT_BASES = [
    ("cb_framework", "FW", "Framework agreement"),
    ("cb_po", "PO", "Purchase order"),
    ("cb_spot", "SPOT", "Spot contract"),
]

CONTRACT_TYPES = [
    ("ct_standard", "STD", "Hợp đồng tiêu chuẩn"),
    ("ct_high_value", "HIGH", "Giá trị lớn"),
]

DISCOUNT_OPTIONS = [("yes", "YES", "Có"), ("no", "NO", "Không")]


def _catalog(db, kind: str, rows, *, parent: bool = False, attrs=None) -> int:
    added = 0
    for index, row in enumerate(rows):
        if parent:
            parent_slug, code, label = row
            slug = f"cn_{parent_slug}_{code.lower()}"
        else:
            slug, code, label = row
            parent_slug = None

        exists = db.execute(
            select(CatalogItem).where(CatalogItem.kind == kind, CatalogItem.slug == slug)
        ).scalar_one_or_none()
        if exists is not None:
            continue

        db.add(
            CatalogItem(
                kind=kind,
                slug=slug,
                code=code,
                label=label,
                parent_slug=parent_slug,
                attrs=attrs or {},
                sort_order=index,
            )
        )
        added += 1
    return added


def seed() -> None:
    with session_scope() as db:
        created_users = 0
        by_username: dict[str, User] = {}

        for username, full_name, role, department, _ in USERS:
            existing = db.execute(
                select(User).where(func.lower(User.username) == username)
            ).scalar_one_or_none()
            if existing is not None:
                by_username[username] = existing
                continue
            user = User(
                username=username,
                full_name=full_name,
                password_hash=hash_password(PASSWORDS.get(username, DEFAULT_PASSWORD)),
                email=f"{username}@saint-gobain.local",
                department=department,
                role=role,
                permissions=[],  # rỗng ⇒ dùng bộ mặc định của role
                active=True,
            )
            db.add(user)
            db.flush()
            by_username[username] = user
            created_users += 1

        for username, _, _, _, manager in USERS:
            if manager and username in by_username and manager in by_username:
                by_username[username].line_manager_id = by_username[manager].id

        added = 0
        added += _catalog(db, "documentCategories", CATEGORIES)
        added += _catalog(db, "contractNames", CONTRACT_NAMES, parent=True)
        added += _catalog(db, "businessEntities", BUSINESS_ENTITIES)
        added += _catalog(db, "contractBases", CONTRACT_BASES)
        added += _catalog(
            db,
            "contractTypes",
            CONTRACT_TYPES,
            attrs={"group": "framework", "requireTemplateMatch": False, "hasChecklist": False},
        )
        added += _catalog(db, "discountOptions", DISCOUNT_OPTIONS)

        print(f"seed: thêm {created_users} tài khoản, {added} mục danh mục")
        print("  admin/admin (IT) · legal/demo123 · manager.pur/demo123 · van.a/demo123")


if __name__ == "__main__":
    seed()
