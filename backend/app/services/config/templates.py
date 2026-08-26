"""
Đăng ký template hợp đồng và ràng buộc cấu trúc khi upload.

## Lỗ hổng mà module này vá

Blueprint v1.6 bỏ việc so khớp file upload với template. Bỏ **so khớp nội dung**
là đúng — vùng mở thay đổi hợp lệ nên so nội dung sẽ báo sai liên tục. Nhưng bỏ
mà không thay gì thì kịch bản này thành hiện thực:

    Purchasing tải template về → gỡ Restrict Editing bằng Word → sửa điều khoản
    "Luật áp dụng" → upload lên. Hệ thống thấy 0 permStart ⇒ coi TOÀN BỘ tài
    liệu là vùng mở ⇒ AI được phép ghi đè khung pháp lý.

Thay thế là **ràng buộc cấu trúc**: cơ chế khoá, tập `permId`, phân loại vùng và
hash nội dung vùng khoá phải khớp bản template Legal đã đăng ký.

## Hai đường vào tài liệu

- **Đường chính — instantiate:** Purchasing chọn loại HĐ, hệ thống sinh tài liệu
  từ template đã đăng ký. Không upload gì. Inventory vùng mở/khoá **tin cậy
  tuyệt đối** vì file do chính hệ thống sinh ra.
- **Đường phụ — upload:** vẫn cho tải `.docx` lên, nhưng **bắt buộc qua binding**.
  Không khớp thì chặn, **không có override** (nhất quán ràng buộc C-4).

## Khi loại HĐ chưa có template

Không thể bắt mọi loại HĐ phải có template ngay ngày đầu. Nên quyết định theo cờ
`requireTemplateMatch` trên chính mục danh mục `contractNames`:

    True  → chưa đăng ký template thì **chặn upload**, nói rõ để Legal bổ sung
    False → cho qua, nhưng ghi `binding.status = "unbound"` và trả cảnh báo lên
            UI. Cố ý KHÔNG im lặng: người duyệt phải biết tài liệu này chưa
            được ràng buộc cấu trúc.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import ConflictError, NotFoundError, StructuralBindingError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import CatalogItem, ContractTemplate
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.model import Mechanism, RegionKind
from app.services.document.structural_binding import (
    FieldStructureIssue,
    LockedParagraphRef,
    TemplateBinding,
    TemplateRegion,
    build_binding,
    verify,
)
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.templates")

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ─────────────────────────────────────────────────────────────────────────────
# Chuyển đổi TemplateBinding ↔ JSONB
# ─────────────────────────────────────────────────────────────────────────────
def binding_to_json(binding: TemplateBinding) -> dict[str, Any]:
    return {
        "mechanism": binding.mechanism.value,
        "protectionEffective": binding.protection_effective,
        "lockedFingerprint": binding.locked_fingerprint,
        "structureFingerprint": binding.structure_fingerprint,
        "regions": [{**asdict(r), "region_kind": r.region_kind.value} for r in binding.regions],
        "lockedParagraphs": [asdict(p) for p in binding.locked_paragraphs],
    }


def binding_from_json(data: dict[str, Any]) -> TemplateBinding:
    """
    Dựng lại binding từ DB.

    Chịu được bản ghi thiếu khoá (dữ liệu cũ): thiếu thì coi như rỗng chứ không
    ném — một template đăng ký từ vòng trước không được làm sập luồng upload.
    """
    return TemplateBinding(
        mechanism=Mechanism(data.get("mechanism") or Mechanism.NONE.value),
        protection_effective=bool(data.get("protectionEffective")),
        locked_fingerprint=str(data.get("lockedFingerprint") or ""),
        structure_fingerprint=str(data.get("structureFingerprint") or ""),
        regions=tuple(
            TemplateRegion(
                perm_id=str(r["perm_id"]),
                ordinal=int(r.get("ordinal") or 0),
                region_kind=RegionKind(r.get("region_kind") or RegionKind.ATOMIC_FIELD.value),
                para_count=int(r.get("para_count") or 0),
                label=r.get("label"),
            )
            for r in (data.get("regions") or [])
        ),
        locked_paragraphs=tuple(
            LockedParagraphRef(
                para_id=str(p["para_id"]),
                ordinal=int(p.get("ordinal") or 0),
                label=p.get("label"),
                text_sha256=str(p.get("text_sha256") or ""),
                preview=str(p.get("preview") or ""),
            )
            for p in (data.get("lockedParagraphs") or [])
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Đăng ký
# ─────────────────────────────────────────────────────────────────────────────
def register(
    db: Session,
    principal: Principal,
    *,
    contract_name_slug: str,
    file_name: str,
    blob: bytes,
    field_labels: dict[str, str] | None = None,
) -> ContractTemplate:
    """
    Legal đăng ký một template. Mỗi lần đăng ký là **một version mới**, bản cũ
    KHÔNG bị xoá — review đang chạy vẫn trỏ vào version của nó.

    Kiểm định luôn lúc đăng ký thay vì để phát hiện muộn: template không có
    Restrict Editing hiệu lực thì mọi file sinh từ nó đều coi cả tài liệu là mở.
    """
    if not file_name.lower().endswith(".docx"):
        raise ValidationError("Template phải là tệp .docx", code="invalid_file_type")

    engine = LxmlDocumentEngine()
    try:
        inventory = engine.get_field_inventory(engine.parse(blob))
    except Exception as e:
        raise ValidationError(f"Không đọc được template: {e}", code="invalid_docx") from e

    issues = lint(inventory)
    blocking = [i for i in issues if i.type in _BLOCKING_LINT]
    if blocking:
        raise StructuralBindingError([i.as_payload() for i in blocking])

    current = active_for(db, contract_name_slug)

    # Đăng ký lại cùng một template mà không khai nhãn ⇒ **kế thừa nhãn bản cũ**.
    # Không kế thừa thì mỗi lần Legal tải lên bản sửa nhỏ là mất sạch tên nghiệp
    # vụ đã đặt, và mọi vùng quay về "Vùng mở #7". Chỉ giữ nhãn của những permId
    # còn tồn tại trong bản mới — permId biến mất thì nhãn của nó cũng vô nghĩa.
    labels = dict(field_labels or {})
    if not labels and current is not None:
        alive = {f.perm_id for f in inventory.fields}
        labels = {k: v for k, v in (current.field_labels or {}).items() if k in alive}

    binding = build_binding(inventory, labels)

    next_version = (current.version + 1) if current else 1
    if current is not None:
        current.is_active = False

    stored = get_storage().put(
        blob,
        prefix=f"templates/{contract_name_slug}",
        file_name=file_name,
        content_type=DOCX_MIME,
    )
    row = ContractTemplate(
        contract_name_slug=contract_name_slug,
        version=next_version,
        file_name=file_name,
        storage_key=stored.key,
        sha256=stored.sha256,
        mechanism=binding.mechanism.value,
        protection_effective=binding.protection_effective,
        open_region_count=binding.open_region_count,
        locked_fingerprint=binding.locked_fingerprint,
        structure_fingerprint=binding.structure_fingerprint,
        binding=binding_to_json(binding),
        field_labels=labels,
        is_active=True,
        registered_by=principal.user_id,
    )
    db.add(row)
    db.flush()
    log.info(
        "đăng ký template %s v%s — %s vùng mở, %s cảnh báo",
        contract_name_slug,
        next_version,
        binding.open_region_count,
        len(issues),
    )
    return row


# Cảnh báo mức CHẶN khi đăng ký. Ba thứ này làm binding trở nên vô nghĩa, nên
# nhận vào rồi mới phát hiện thì tệ hơn là từ chối ngay.
_BLOCKING_LINT = frozenset({"no_open_region", "protection_removed", "mechanism_mismatch"})


def lint(inventory) -> list[FieldStructureIssue]:
    """
    Kiểm định một template trước khi nhận.

    Trả về **mọi** vấn đề, kể cả không chặn — Legal cần thấy hết để sửa file.
    """
    out: list[FieldStructureIssue] = []

    if not inventory.fields:
        out.append(
            FieldStructureIssue(
                type="no_open_region",
                location="toàn tài liệu",
                diff_preview=(
                    "Không có vùng mở nào (permStart / Content Control). Hệ thống "
                    "không biết Purchasing được sửa ở đâu"
                ),
            )
        )

    protection = inventory.protection
    if protection is None or not protection.is_effective:
        out.append(
            FieldStructureIssue(
                type="protection_removed",
                location="settings.xml",
                diff_preview=(
                    "Restrict Editing không có hiệu lực"
                    + (
                        f" (edit={protection.edit}, enforcement={protection.enforcement})"
                        if protection
                        else ""
                    )
                    + ". Word sẽ không chặn người dùng sửa vùng khoá"
                ),
            )
        )

    if inventory.mechanism is Mechanism.NONE:
        out.append(
            FieldStructureIssue(
                type="mechanism_mismatch",
                location="toàn tài liệu",
                diff_preview="Không nhận ra cơ chế đánh dấu vùng mở nào",
            )
        )

    # Vùng rỗng và vùng bắc qua bảng: ghi nhận, KHÔNG chặn. Chúng tồn tại thật
    # trong template đang lưu hành (vùng 1808140627 của hợp đồng THACO rỗng hoàn
    # toàn), chỉ là hệ thống không ghi được nên chuyển sang chế độ chú thích.
    for f in inventory.fields:
        if f.region_kind is RegionKind.EMPTY:
            out.append(
                FieldStructureIssue(
                    type="empty_region",
                    location=f"vùng mở #{f.ordinal}",
                    field_id=f.perm_id,
                    diff_preview="Vùng rỗng — không có định dạng để kế thừa, không ghi được",
                )
            )
        elif f.region_kind is RegionKind.CROSS_TABLE:
            out.append(
                FieldStructureIssue(
                    type="cross_table_region",
                    location=f"vùng mở #{f.ordinal}",
                    field_id=f.perm_id,
                    diff_preview="Vùng bắc qua ranh giới bảng — chỉ chú thích, không ghi",
                )
            )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Truy vấn
# ─────────────────────────────────────────────────────────────────────────────
def active_for(db: Session, contract_name_slug: str) -> ContractTemplate | None:
    if not contract_name_slug:
        return None
    return db.execute(
        select(ContractTemplate)
        .where(
            ContractTemplate.contract_name_slug == contract_name_slug,
            ContractTemplate.is_active.is_(True),
        )
        .order_by(ContractTemplate.version.desc())
        .limit(1)
    ).scalar_one_or_none()


def list_all(db: Session, *, contract_name_slug: str | None = None) -> list[ContractTemplate]:
    stmt = select(ContractTemplate).order_by(
        ContractTemplate.contract_name_slug, ContractTemplate.version.desc()
    )
    if contract_name_slug:
        stmt = stmt.where(ContractTemplate.contract_name_slug == contract_name_slug)
    return list(db.execute(stmt).scalars())


def get(db: Session, template_id) -> ContractTemplate:
    row = db.get(ContractTemplate, template_id)
    if row is None:
        raise NotFoundError("Template")
    return row


def set_field_labels(db: Session, template_id, labels: dict[str, str]) -> ContractTemplate:
    """
    Đặt tên nghiệp vụ cho từng vùng mở.

    Cần thiết vì `permId` của Range Permission là **số nguyên ngẫu nhiên không
    có tên** (`1808140627`, `293691561`…). Không có bảng ánh xạ này thì UI chỉ
    hiện được "Vùng mở #7" và AI không biết vùng đó là điều khoản gì.
    """
    row = get(db, template_id)
    known = {r["perm_id"] for r in (row.binding.get("regions") or [])}
    unknown = sorted(set(labels) - known)
    if unknown:
        raise ValidationError(
            f"Các permId không có trong template: {', '.join(unknown[:5])}",
            code="unknown_perm_id",
        )

    row.field_labels = dict(labels)
    # Dựng lại binding để `label` đi kèm mọi thông báo lỗi về sau
    binding = binding_from_json(row.binding)
    row.binding = binding_to_json(
        TemplateBinding(
            mechanism=binding.mechanism,
            protection_effective=binding.protection_effective,
            locked_fingerprint=binding.locked_fingerprint,
            structure_fingerprint=binding.structure_fingerprint,
            regions=tuple(
                TemplateRegion(
                    perm_id=r.perm_id,
                    ordinal=r.ordinal,
                    region_kind=r.region_kind,
                    para_count=r.para_count,
                    label=labels.get(r.perm_id, r.label),
                )
                for r in binding.regions
            ),
            locked_paragraphs=binding.locked_paragraphs,
        )
    )
    db.flush()
    return row


def instantiate(db: Session, contract_name_slug: str) -> tuple[ContractTemplate, bytes]:
    """
    Đường chính: lấy bytes của template để sinh tài liệu mới.

    File do hệ thống cấp nên inventory vùng mở/khoá tin cậy tuyệt đối — không
    cần binding, vì nó khớp với chính nó.
    """
    row = active_for(db, contract_name_slug)
    if row is None:
        raise ConflictError(
            f"Legal chưa đăng ký template cho loại hợp đồng “{contract_name_slug}”",
            code="template_not_registered",
        )
    return row, get_storage().get(row.storage_key)


# ─────────────────────────────────────────────────────────────────────────────
# Ràng buộc cấu trúc khi upload
# ─────────────────────────────────────────────────────────────────────────────
def require_template_match(db: Session, contract_name_slug: str) -> bool:
    """Cờ trên mục danh mục `contractNames`. Không tìm thấy mục ⇒ không bắt buộc."""
    item = db.execute(
        select(CatalogItem).where(
            CatalogItem.kind == "contractNames",
            CatalogItem.slug == contract_name_slug,
        )
    ).scalar_one_or_none()
    return bool(item and (item.attrs or {}).get("requireTemplateMatch"))


def bind_upload(db: Session, *, contract_name_slug: str, inventory) -> dict[str, Any]:
    """
    Đối chiếu file upload với template đã đăng ký.

    Ném `StructuralBindingError` (422, **không có override**) khi lệch. Trả về
    mô tả trạng thái binding để ghim vào `intake` — người duyệt phải thấy được
    tài liệu này đã ràng buộc hay chưa.
    """
    template = active_for(db, contract_name_slug)

    if template is None:
        if require_template_match(db, contract_name_slug):
            raise ConflictError(
                f"Loại hợp đồng “{contract_name_slug}” yêu cầu khớp template nhưng "
                "Legal chưa đăng ký bản nào — đề nghị Legal bổ sung tại "
                "Configurations → Template",
                code="template_not_registered",
            )
        # Không chặn, nhưng KHÔNG im lặng: người duyệt phải biết
        log.warning("upload không ràng buộc cấu trúc: %s chưa có template", contract_name_slug)
        return {
            "status": "unbound",
            "reason": "Loại hợp đồng này chưa có template đăng ký — file không được "
            "đối chiếu cấu trúc",
        }

    issues = verify(inventory, binding_from_json(template.binding))
    if issues:
        raise StructuralBindingError([i.as_payload() for i in issues])

    return {
        "status": "bound",
        "templateId": str(template.id),
        "templateVersion": template.version,
        "structureFingerprint": template.structure_fingerprint,
    }


__all__ = [
    "active_for",
    "bind_upload",
    "binding_from_json",
    "binding_to_json",
    "get",
    "instantiate",
    "lint",
    "list_all",
    "register",
    "require_template_match",
    "set_field_labels",
]
