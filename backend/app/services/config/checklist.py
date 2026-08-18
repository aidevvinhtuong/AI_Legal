"""
Cấu hình checklist hai lớp và phép gộp cha ∪ con.

Đây là **nguồn sự thật pháp lý duy nhất** của AI (ràng buộc C-12): prompt chỉ mô
tả hành vi, mọi nội dung Ideal / Fallback / Red Line / severity / keywords đều
đến từ đây và được inject qua `{{checklist_items}}`.

Phép gộp (Blueprint §3.3.6): lấy checklist của Loại HĐ cha làm nền, chồng
overlay của Tên HĐ lên. **Cùng `clause.code` thì bản con thắng.** Tên HĐ chưa có
overlay vẫn chạy được — nó hưởng nguyên checklist cha.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ConfigLayer
from app.domain.errors import NotFoundError, ValidationError
from app.infra.models import CatalogItem, ChecklistConfig

DEFAULT_AI_TIERS: dict[str, Any] = {
    "ruleBasedEnabled": True,
    "semanticEnabled": True,
    "notes": "",
}


@dataclass(frozen=True)
class MergedChecklist:
    """Kết quả gộp — cái mà pipeline AI thật sự đọc."""

    contract_name_id: str
    parent_category_id: str
    clauses: list[dict[str, Any]]
    ai_tiers: dict[str, Any]
    parent_clause_count: int
    child_clause_count: int
    overridden_codes: tuple[str, ...]
    has_child_overlay: bool

    @property
    def config_version_key(self) -> str:
        """Khoá để ghi vào `ai_runs.checklist_config_version` — truy vết kết luận AI."""
        codes = ",".join(sorted(str(c.get("code", "")) for c in self.clauses))
        import hashlib

        return hashlib.sha256(codes.encode()).hexdigest()[:16]


def get_config(db: Session, *, layer: ConfigLayer, contract_type_id: str) -> ChecklistConfig | None:
    return db.execute(
        select(ChecklistConfig).where(
            ChecklistConfig.config_layer == layer.value,
            ChecklistConfig.contract_type_id == contract_type_id,
        )
    ).scalar_one_or_none()


def ensure_parent_config(db: Session, category_slug: str, *, actor: str = "") -> ChecklistConfig:
    """
    Lấy cấu hình của Loại HĐ cha, chưa có thì tạo rỗng.

    Idempotent: Legal bấm "Cấu hình" nhiều lần không sinh ra nhiều bản.
    """
    existing = get_config(db, layer=ConfigLayer.PARENT, contract_type_id=category_slug)
    if existing is not None:
        return existing

    category = _catalog(db, "documentCategories", category_slug)
    config = ChecklistConfig(
        contract_type_id=category_slug,
        parent_category_id=category_slug,
        config_layer=ConfigLayer.PARENT.value,
        label=category.label,
        created_by=actor,
        updated_by=actor,
        ai_tiers=dict(DEFAULT_AI_TIERS),
    )
    db.add(config)
    db.flush()
    return config


def ensure_child_config(
    db: Session, contract_name_slug: str, *, actor: str = ""
) -> ChecklistConfig:
    """Tạo overlay cho một Tên HĐ (opt-in — chỉ khi Legal chủ động thêm)."""
    existing = get_config(db, layer=ConfigLayer.CHILD, contract_type_id=contract_name_slug)
    if existing is not None:
        return existing

    name = _catalog(db, "contractNames", contract_name_slug)
    if not name.parent_slug:
        raise ValidationError(
            f"Tên hợp đồng “{name.label}” chưa gắn Loại hợp đồng cha",
            code="contract_name_without_category",
        )

    # Overlay chỉ có nghĩa khi đã có checklist cha để chồng lên
    ensure_parent_config(db, name.parent_slug, actor=actor)

    config = ChecklistConfig(
        contract_type_id=contract_name_slug,
        parent_category_id=name.parent_slug,
        config_layer=ConfigLayer.CHILD.value,
        label=name.label,
        created_by=actor,
        updated_by=actor,
        ai_tiers=dict(DEFAULT_AI_TIERS),
    )
    db.add(config)
    db.flush()
    return config


def merge_for_contract_name(db: Session, contract_name_slug: str) -> MergedChecklist:
    """
    Bản gộp mà AI đọc. Không có overlay vẫn trả về đủ checklist cha.

    Không tìm thấy Tên HĐ trong danh mục thì trả về bản rỗng thay vì ném lỗi:
    Blueprint §1.3.4 cho phép tạo hợp đồng khi chưa có checklist, chỉ cảnh báo
    "AI review mang tính tham khảo".
    """
    name = db.execute(
        select(CatalogItem).where(
            CatalogItem.kind == "contractNames", CatalogItem.slug == contract_name_slug
        )
    ).scalar_one_or_none()

    parent_slug = name.parent_slug if name is not None else None
    parent = (
        get_config(db, layer=ConfigLayer.PARENT, contract_type_id=parent_slug)
        if parent_slug
        else None
    )
    child = get_config(db, layer=ConfigLayer.CHILD, contract_type_id=contract_name_slug)

    parent_clauses = list(parent.clauses) if parent else []
    child_clauses = list(child.clauses) if child else []

    by_code: dict[str, dict[str, Any]] = {}
    for clause in parent_clauses:
        code = str(clause.get("code") or "").strip()
        if code:
            by_code[code] = clause

    overridden: list[str] = []
    for clause in child_clauses:
        code = str(clause.get("code") or "").strip()
        if not code:
            continue
        if code in by_code:
            overridden.append(code)
        by_code[code] = clause

    merged = [c for c in by_code.values() if c.get("active", True)]
    merged.sort(key=lambda c: (c.get("sortOrder", 0), str(c.get("code", ""))))

    # aiTiers: có overlay thì lấy của con, không thì của cha (Blueprint §3.3.3)
    tiers = (child.ai_tiers if child else None) or (parent.ai_tiers if parent else None)

    return MergedChecklist(
        contract_name_id=contract_name_slug,
        parent_category_id=parent_slug or "",
        clauses=merged,
        ai_tiers=dict(tiers or DEFAULT_AI_TIERS),
        parent_clause_count=len(parent_clauses),
        child_clause_count=len(child_clauses),
        overridden_codes=tuple(sorted(set(overridden))),
        has_child_overlay=child is not None,
    )


def next_clause_code(clauses: list[dict[str, Any]]) -> str:
    """`CL-001`, `CL-002`… Mã ổn định giữa các lần sửa, không tái sử dụng."""
    highest = 0
    for clause in clauses:
        code = str(clause.get("code") or "")
        if code.upper().startswith("CL-"):
            try:
                highest = max(highest, int(code[3:]))
            except ValueError:
                continue
    return f"CL-{highest + 1:03d}"


def _catalog(db: Session, kind: str, slug: str) -> CatalogItem:
    item = db.execute(
        select(CatalogItem).where(CatalogItem.kind == kind, CatalogItem.slug == slug)
    ).scalar_one_or_none()
    if item is None:
        raise NotFoundError(f"Mục danh mục “{slug}”")
    return item
