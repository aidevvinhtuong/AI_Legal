"""
Cấu hình checklist (Legal) và Phân quyền ký (IT).

Khác FE hiện tại ở một chỗ có chủ đích: FE có hai bộ endpoint gần trùng nhau
(`/config/parent-categories/*` và `/config/contract-types/*`) cho hai lớp cấu
hình. Ở đây gộp thành một resource `/config/configs` có `layer=parent|child`,
và giữ hai đường cũ làm bí danh để FE chuyển dần.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require
from app.domain.enums import ConfigLayer, Permission
from app.domain.errors import ConflictError, NotFoundError
from app.infra.models import AuditLog, CatalogItem, ChecklistConfig, ContractReview
from app.services.config import checklist

router = APIRouter(
    prefix="/api/v1/config",
    tags=["config"],
    dependencies=[Depends(require(Permission.CONTRACT_CONFIG))],
)


def _out(config: ChecklistConfig) -> dict[str, Any]:
    return {
        "id": str(config.id),
        "contractTypeId": config.contract_type_id,
        "parentCategoryId": config.parent_category_id,
        "configLayer": config.config_layer,
        "label": config.label,
        "group": config.group,
        "lifecycle": config.lifecycle,
        "version": config.version,
        "requireTemplateMatch": config.require_template_match,
        "templateFileName": config.template_file_name,
        "clauses": config.clauses or [],
        "approvalMatrixId": config.approval_matrix_id,
        "aiTiers": config.ai_tiers or checklist.DEFAULT_AI_TIERS,
        "status": config.status,
        "createdAt": config.created_at.isoformat(),
        "updatedAt": config.updated_at.isoformat(),
        "createdBy": config.created_by,
        "updatedBy": config.updated_by,
        "rowVersion": config.row_version,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Đọc
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/versions")
def list_configs(
    db: DbSession,
    layer: str | None = Query(None),
    includeArchived: bool = Query(False),  # noqa: N803
) -> list[dict[str, Any]]:
    stmt = select(ChecklistConfig)
    if layer:
        stmt = stmt.where(ChecklistConfig.config_layer == layer)
    if not includeArchived:
        stmt = stmt.where(ChecklistConfig.status == "active")
    rows = db.execute(stmt.order_by(ChecklistConfig.config_layer, ChecklistConfig.label)).scalars()
    return [_out(c) for c in rows]


@router.get("/versions/{config_id}")
def get_config(config_id: str, db: DbSession) -> dict[str, Any]:
    return _out(_load(db, config_id))


@router.get("/merged/{contract_name_slug}")
def merged(contract_name_slug: str, db: DbSession) -> dict[str, Any]:
    """
    Bản gộp cha ∪ con — chính thứ pipeline AI đọc.

    Hữu ích cho UI ("AI gộp: n điều khoản") và để Legal kiểm chứng overlay của
    mình có thật sự đè lên điều khoản cha hay không.
    """
    result = checklist.merge_for_contract_name(db, contract_name_slug)
    return {
        "contractNameId": result.contract_name_id,
        "parentCategoryId": result.parent_category_id,
        "clauses": result.clauses,
        "aiTiers": result.ai_tiers,
        "parentClauseCount": result.parent_clause_count,
        "childClauseCount": result.child_clause_count,
        "overriddenCodes": list(result.overridden_codes),
        "hasChildOverlay": result.has_child_overlay,
        "configVersionKey": result.config_version_key,
    }


@router.get("/parent-categories")
def parent_categories(db: DbSession) -> list[dict[str, Any]]:
    """Loại HĐ cha (active) kèm số điều khoản đã cấu hình."""
    items = db.execute(
        select(CatalogItem)
        .where(CatalogItem.kind == "documentCategories", CatalogItem.status == "active")
        .order_by(CatalogItem.sort_order, CatalogItem.label)
    ).scalars()

    configs = {
        c.contract_type_id: c
        for c in db.execute(
            select(ChecklistConfig).where(ChecklistConfig.config_layer == ConfigLayer.PARENT.value)
        ).scalars()
    }
    out = []
    for item in items:
        config = configs.get(item.slug)
        out.append(
            {
                "id": item.slug,
                "code": item.code,
                "label": item.label,
                "clauseCount": len(config.clauses or []) if config else 0,
                "configId": str(config.id) if config else None,
            }
        )
    return out


@router.get("/contract-names")
def contract_names(
    db: DbSession,
    categoryId: str | None = Query(None),  # noqa: N803
) -> list[dict[str, Any]]:
    """Tên HĐ và trạng thái overlay — chỉ tên ĐÃ có overlay mới hiện trên bảng."""
    stmt = select(CatalogItem).where(
        CatalogItem.kind == "contractNames", CatalogItem.status == "active"
    )
    if categoryId:
        stmt = stmt.where(CatalogItem.parent_slug == categoryId)

    overlays = {
        c.contract_type_id: c
        for c in db.execute(
            select(ChecklistConfig).where(ChecklistConfig.config_layer == ConfigLayer.CHILD.value)
        ).scalars()
    }
    out = []
    for item in db.execute(stmt.order_by(CatalogItem.label)).scalars():
        overlay = overlays.get(item.slug)
        out.append(
            {
                "id": item.slug,
                "label": item.label,
                "documentCategoryId": item.parent_slug,
                "hasOverlay": overlay is not None,
                "configId": str(overlay.id) if overlay else None,
                "clauseCount": len(overlay.clauses or []) if overlay else 0,
            }
        )
    return out


@router.get("/audit")
def config_audit(
    db: DbSession,
    contractTypeId: str | None = Query(None),  # noqa: N803
) -> list[dict[str, Any]]:
    stmt = select(AuditLog).where(AuditLog.entity_type == "checklist_config")
    if contractTypeId:
        stmt = stmt.where(AuditLog.entity_id == contractTypeId)
    rows = db.execute(stmt.order_by(AuditLog.at.desc()).limit(200)).scalars()
    return [
        {
            "id": str(r.id),
            "contractTypeId": r.entity_id,
            "action": r.action,
            "actorName": r.actor_name,
            "actorRole": r.actor_role,
            "at": r.at.isoformat(),
            "oldValue": r.old_value,
            "newValue": r.new_value,
            "note": r.note,
        }
        for r in rows
    ]


@router.get("/matrices")
def matrices() -> list[dict[str, Any]]:
    """
    Approval Matrix — **ngoài phạm vi Sprint 1** (quyết định A3, Blueprint §VII).

    Trả mảng rỗng thay vì 404 để màn cấu hình không vỡ; việc phân bậc duyệt do
    bảng Phân quyền ký đảm nhiệm.
    """
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Ghi
# ─────────────────────────────────────────────────────────────────────────────
class ConfigIn(BaseModel):
    label: str | None = None
    group: str | None = None
    requireTemplateMatch: bool | None = None  # noqa: N815
    templateFileName: str | None = None  # noqa: N815
    approvalMatrixId: str | None = None  # noqa: N815
    clauses: list[dict[str, Any]] | None = None
    aiTiers: dict[str, Any] | None = None  # noqa: N815


@router.put("/versions/{config_id}")
def save_config(
    config_id: str, payload: ConfigIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Sửa + Lưu trực tiếp — Sprint 1 bỏ workflow Draft/Publish (Blueprint §3.1).
    Bản đã Lưu áp dụng ngay cho lần AI review kế tiếp.
    """
    config = _load(db, config_id)
    before = {"clauseCount": len(config.clauses or []), "aiTiers": config.ai_tiers}

    if payload.label is not None:
        config.label = payload.label
    if payload.group is not None:
        config.group = payload.group
    if payload.requireTemplateMatch is not None:
        config.require_template_match = payload.requireTemplateMatch
    if payload.templateFileName is not None:
        config.template_file_name = payload.templateFileName
    if payload.approvalMatrixId is not None:
        config.approval_matrix_id = payload.approvalMatrixId
    if payload.aiTiers is not None:
        config.ai_tiers = payload.aiTiers
    if payload.clauses is not None:
        config.clauses = _normalise_clauses(payload.clauses)

    config.version += 1
    config.updated_by = principal.username
    _audit(db, principal, config, "update_meta", before, {"clauseCount": len(config.clauses)})
    db.flush()
    return _out(config)


@router.post("/parent-categories/{category_slug}/ensure")
def ensure_parent(category_slug: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    config = checklist.ensure_parent_config(db, category_slug, actor=principal.username)
    _audit(db, principal, config, "create_draft", None, {"layer": "parent"})
    return _out(config)


@router.post("/contract-names/{contract_name_slug}/ensure")
def ensure_child(contract_name_slug: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    config = checklist.ensure_child_config(db, contract_name_slug, actor=principal.username)
    _audit(db, principal, config, "create_draft", None, {"layer": "child"})
    return _out(config)


@router.post("/versions/{config_id}/archive")
def archive_config(config_id: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    config = _load(db, config_id)
    config.status = "archived"
    _audit(db, principal, config, "archive", {"status": "active"}, {"status": "archived"})
    db.flush()
    return _out(config)


@router.post("/versions/{config_id}/restore")
def restore_config(config_id: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    config = _load(db, config_id)
    config.status = "active"
    _audit(db, principal, config, "restore", {"status": "archived"}, {"status": "active"})
    db.flush()
    return _out(config)


@router.delete("/versions/{config_id}")
def delete_config(config_id: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Xoá overlay. Chặn khi còn hợp đồng dùng Tên HĐ đó — xoá cấu hình pháp lý mà
    hợp đồng vẫn tham chiếu là mất dấu vết đã review theo luật nào.
    """
    config = _load(db, config_id)
    if config.config_layer == ConfigLayer.PARENT.value:
        raise ConflictError(
            "Không xoá cấu hình Loại HĐ cha — hãy lưu trữ tại Form lists",
            code="cannot_delete_parent_config",
        )

    used = (
        db.query(ContractReview)
        .filter(ContractReview.contract_type_id == config.contract_type_id)
        .count()
    )
    if used:
        raise ConflictError(
            f"Có {used} hợp đồng đang dùng Tên HĐ này — hãy Lưu trữ thay vì Xoá",
            code="config_in_use",
            usageCount=used,
        )

    _audit(db, principal, config, "delete", {"clauseCount": len(config.clauses or [])}, None)
    db.delete(config)
    db.flush()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Bí danh theo lớp cấu hình
#
# FE gọi cấu hình bằng **khoá nghiệp vụ** (`contract-types/{slug}` cho overlay
# Tên HĐ, `parent-categories/{slug}` cho checklist Loại HĐ cha) chứ không bằng
# id bản ghi. `_load` đã nhận cả slug lẫn uuid, nên đây thuần là ba cặp tên
# đường dẫn trỏ về đúng ba handler ở trên — không nhân bản luật nào.
# ─────────────────────────────────────────────────────────────────────────────
for _prefix in ("contract-types", "parent-categories"):
    router.add_api_route(
        f"/{_prefix}/{{config_id}}/archive",
        archive_config,
        methods=["POST"],
        summary=f"Lưu trữ cấu hình ({_prefix})",
    )
    router.add_api_route(
        f"/{_prefix}/{{config_id}}/restore",
        restore_config,
        methods=["POST"],
        summary=f"Khôi phục cấu hình ({_prefix})",
    )
    # Với lớp cha, `delete_config` từ chối kèm lý do (chỉ được Lưu trữ) — cố ý
    # dùng chung handler để luật đó chỉ tồn tại ở một chỗ.
    router.add_api_route(
        f"/{_prefix}/{{config_id}}",
        delete_config,
        methods=["DELETE"],
        summary=f"Xoá cấu hình ({_prefix})",
    )


# ─────────────────────────────────────────────────────────────────────────────
def _load(db, config_id: str) -> ChecklistConfig:
    import uuid as _uuid

    try:
        pk = _uuid.UUID(config_id)
    except ValueError:
        # FE có chỗ dùng slug nghiệp vụ thay cho uuid — chấp nhận cả hai
        config = db.execute(
            select(ChecklistConfig).where(ChecklistConfig.contract_type_id == config_id)
        ).scalar_one_or_none()
        if config is None:
            raise NotFoundError("Cấu hình") from None
        return config

    config = db.get(ChecklistConfig, pk)
    if config is None:
        raise NotFoundError("Cấu hình")
    return config


def _normalise_clauses(clauses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cấp mã `CL-xxx` cho điều khoản mới; mã đã có thì giữ nguyên vĩnh viễn."""
    out: list[dict[str, Any]] = []
    for index, clause in enumerate(clauses):
        item = dict(clause)
        if not str(item.get("code") or "").strip():
            item["code"] = checklist.next_clause_code(out)
        item.setdefault("active", True)
        item.setdefault("sortOrder", index)
        item.setdefault("keywords", [])
        item.setdefault("patterns", [])
        item.setdefault("enableRuleBased", True)
        item.setdefault("enableSemantic", True)
        out.append(item)
    return out


def _audit(
    db,
    principal,
    config: ChecklistConfig,
    action: str,
    old: dict[str, Any] | None,
    new: dict[str, Any] | None,
) -> None:
    db.add(
        AuditLog(
            actor_id=principal.user_id,
            actor_name=principal.username,
            actor_role=principal.role.value,
            action=action,
            entity_type="checklist_config",
            entity_id=config.contract_type_id,
            old_value=old,
            new_value=new,
        )
    )
