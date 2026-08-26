"""
Đăng ký và quản lý template hợp đồng — màn Configurations của Legal.

Đây là **cổng chặn** của mô hình an toàn: template đăng ký ở đây là bản chuẩn để
đối chiếu mọi file Purchasing tải lên. Không có nó thì hệ thống không biết vùng
nào đáng ra phải khoá.

Quyền: `contract_config` — cùng quyền với checklist, vì cùng thuộc Legal.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, require
from app.domain.enums import Permission
from app.domain.errors import ValidationError
from app.infra.models import ContractTemplate
from app.infra.settings import get_settings
from app.services.config import templates
from app.services.document.engine import LxmlDocumentEngine
from app.services.storage.objects import get_storage

router = APIRouter(
    prefix="/api/v1/templates",
    tags=["templates"],
    dependencies=[Depends(require(Permission.CONTRACT_CONFIG))],
)

DOCX_MIME = templates.DOCX_MIME


def _out(row: ContractTemplate) -> dict[str, Any]:
    binding = row.binding or {}
    return {
        "id": str(row.id),
        "contractNameId": row.contract_name_slug,
        "version": row.version,
        "fileName": row.file_name,
        "sha256": row.sha256,
        "mechanism": row.mechanism,
        "protectionEffective": row.protection_effective,
        "openRegionCount": row.open_region_count,
        "lockedFingerprint": row.locked_fingerprint,
        "structureFingerprint": row.structure_fingerprint,
        "isActive": row.is_active,
        "registeredAt": row.created_at.isoformat() if row.created_at else "",
        "fieldLabels": row.field_labels or {},
        # Vùng mở kèm phân loại — Legal cần thấy để đặt tên nghiệp vụ cho từng vùng
        "regions": [
            {
                "permId": r.get("perm_id"),
                "ordinal": r.get("ordinal"),
                "regionKind": r.get("region_kind"),
                "paraCount": r.get("para_count"),
                "label": (row.field_labels or {}).get(r.get("perm_id")) or r.get("label"),
            }
            for r in (binding.get("regions") or [])
        ],
        "lockedParagraphCount": len(binding.get("lockedParagraphs") or []),
        "downloadUrl": f"/api/v1/templates/{row.id}/file",
    }


@router.get("")
def list_templates(
    db: DbSession, principal: CurrentUser, contract_name_id: str | None = None
) -> list[dict[str, Any]]:
    del principal
    return [_out(r) for r in templates.list_all(db, contract_name_slug=contract_name_id)]


@router.post("", status_code=201)
def register_template(
    principal: CurrentUser,
    db: DbSession,
    contract_name_id: str = Form(...),
    field_labels: str = Form("{}"),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """
    Legal đăng ký template. Mỗi lần đăng ký là **một version mới**; bản cũ bị
    tắt `is_active` nhưng KHÔNG xoá — review đang chạy vẫn trỏ vào version của nó.

    Từ chối ngay khi template không đạt: không có vùng mở nào, Restrict Editing
    không hiệu lực, hoặc không nhận ra cơ chế đánh dấu. Nhận vào rồi mới phát
    hiện thì mọi file sinh từ nó đều coi cả tài liệu là vùng mở.
    """
    import json

    try:
        labels = json.loads(field_labels or "{}")
    except json.JSONDecodeError as e:
        raise ValidationError("field_labels không phải JSON hợp lệ") from e
    if not isinstance(labels, dict):
        raise ValidationError("field_labels phải là object permId → tên")

    blob = file.file.read()
    if len(blob) > get_settings().MAX_UPLOAD_BYTES:
        raise ValidationError("Template vượt quá giới hạn kích thước", code="file_too_large")

    row = templates.register(
        db,
        principal,
        contract_name_slug=contract_name_id,
        file_name=file.filename or "template.docx",
        blob=blob,
        field_labels={str(k): str(v) for k, v in labels.items()},
    )
    return _out(row)


@router.post("/lint")
def lint_template(
    principal: CurrentUser, db: DbSession, file: UploadFile = File(...)
) -> dict[str, Any]:
    """
    Kiểm định thử **mà không lưu gì**.

    Cho Legal soi một file trước khi đăng ký: vùng mở nào hệ thống ghi được, vùng
    nào chỉ chú thích, Restrict Editing có hiệu lực không.
    """
    del principal, db
    engine = LxmlDocumentEngine()
    blob = file.file.read()
    try:
        inventory = engine.get_field_inventory(engine.parse(blob))
    except Exception as e:
        raise ValidationError(f"Không đọc được tệp .docx: {e}", code="invalid_docx") from e

    issues = templates.lint(inventory)
    return {
        "fileName": file.filename,
        "mechanism": inventory.mechanism.value,
        "protectionEffective": bool(inventory.protection and inventory.protection.is_effective),
        "openRegionCount": len(inventory.fields),
        "writableRegionCount": len(inventory.writable_perm_ids),
        "paragraphCount": len(inventory.paragraphs),
        "lockedParagraphCount": len(inventory.locked_paragraphs),
        "countsByKind": inventory.counts_by_kind(),
        "commentCount": inventory.comment_count,
        "hasTrackedChanges": inventory.has_tracked_changes,
        "regions": [
            {
                "permId": f.perm_id,
                "ordinal": f.ordinal,
                "regionKind": f.region_kind.value,
                "writable": f.writable,
                "paraCount": f.para_count,
                "charLen": f.char_len,
                "inTable": f.in_table,
                "preview": f.inner_text[:120],
            }
            for f in inventory.fields
        ],
        "issues": [asdict(i) for i in issues],
        "acceptable": not [i for i in issues if i.type in templates._BLOCKING_LINT],
    }


class FieldLabelsIn(BaseModel):
    labels: dict[str, str] = Field(default_factory=dict)


@router.put("/{template_id}/field-labels")
def set_field_labels(
    template_id: uuid.UUID, payload: FieldLabelsIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Đặt tên nghiệp vụ cho từng vùng mở (`template_field_map`).

    Bắt buộc phải có vì `permId` của Range Permission là **số nguyên ngẫu nhiên
    không tên** (`1808140627`…). Không có bảng này thì UI chỉ hiện "Vùng mở #7"
    và AI không biết vùng đó là điều khoản gì.
    """
    del principal
    return _out(templates.set_field_labels(db, template_id, payload.labels))


@router.get("/{template_id}/file")
def download_template(template_id: uuid.UUID, principal: CurrentUser, db: DbSession):
    del principal
    row = templates.get(db, template_id)
    data = get_storage().get(row.storage_key)
    name = f"{row.contract_name_slug}-v{row.version}.docx"
    return StreamingResponse(
        iter([data]),
        media_type=DOCX_MIME,
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Content-Length": str(len(data)),
        },
    )


@router.get("/active/{contract_name_id}")
def active_template(contract_name_id: str, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Template đang hiệu lực của một loại HĐ — FE dùng để biết có bật được nút
    «Sinh từ template» hay không.
    """
    del principal
    row = templates.active_for(db, contract_name_id)
    return {
        "contractNameId": contract_name_id,
        "requireTemplateMatch": templates.require_template_match(db, contract_name_id),
        "template": _out(row) if row else None,
    }


__all__ = ["router"]
