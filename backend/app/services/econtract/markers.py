"""
Quản lý người ký và vị trí marker trên một ticket.

## Hợp đồng dữ liệu với FE — điểm thay đổi lớn nhất của vòng này

FE cũ gửi lên `{page, xPct, yPct}`. Toạ độ trang **chỉ tồn tại sau khi phân
trang**; OOXML không có khái niệm trang, và FPT đã chốt nhận `.docx` chứ không
phải PDF, nên không có bước render nào để dịch ngược toạ độ. Neo mới là
`paraId` — `w14:paraId` của đoạn văn, ổn định qua round-trip Word.

Thao tác của người dùng không đổi: vẫn kéo-thả. Chỉ khác ở chỗ FE gửi lên
`anchor.paraId` của đoạn gần nhất, chọn từ `GET /reviews/{id}/marker-anchors`.

Trong lúc FE chưa đổi, `resolve_anchor()` vẫn nhận `yPct` và quy về một anchor
gợi ý — nhưng đánh dấu `approximated: true` để không ai tưởng vị trí là chính
xác. Đây là đường tạm, không phải thiết kế.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.domain.errors import ConflictError, NotFoundError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import ContractReview, ReviewFile, ReviewVersion
from app.infra.settings import get_settings
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.marker import (
    MarkerAnchor,
    MarkerPlacement,
    insert_markers,
    list_anchors,
)
from app.services.econtract.validation import (
    marker_type_for,
    needs_marker,
    normalize_ui_role,
    signing_recipients,
    validate_markers,
    validate_signers,
)
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.econtract.markers")

SIZE_PRESETS = {"default": (164, 98), "large": (220, 140)}


@dataclass(frozen=True)
class AnchorRequest:
    """Vị trí neo do FE gửi lên. `para_id` rỗng ⇒ rơi vào đường tạm theo `y_pct`."""

    para_id: str = ""
    align: str = "center"
    position: str = "after"
    page: int | None = None
    x_pct: float | None = None
    y_pct: float | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Đọc tài liệu hiện hành
# ─────────────────────────────────────────────────────────────────────────────
def current_file(db: Session, review: ContractReview) -> ReviewFile:
    """Tệp của version mới nhất — nguồn duy nhất để lấy anchor và để chèn marker."""
    version = (
        db.query(ReviewVersion)
        .filter(ReviewVersion.review_id == review.id)
        .order_by(ReviewVersion.version.desc())
        .first()
    )
    file_row = db.get(ReviewFile, version.file_id) if version and version.file_id else None
    if file_row is None:
        raise ConflictError("Ticket chưa có tệp hợp đồng nào", code="missing_file")
    return file_row


def document_anchors(db: Session, review: ContractReview) -> list[MarkerAnchor]:
    engine = LxmlDocumentEngine()
    blob = get_storage().get(current_file(db, review).storage_key)
    return list_anchors(engine.get_field_inventory(engine.parse(blob)))


def anchors_out(anchors: list[MarkerAnchor]) -> list[dict[str, Any]]:
    return [
        {
            "paraId": a.para_id,
            "ordinal": a.ordinal,
            "preview": a.preview,
            "inTable": a.in_table,
            "isOpen": a.is_open,
            "blank": a.blank,
            "clause": a.numbering_label,
            "recommended": a.recommended,
        }
        for a in anchors
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Người ký
# ─────────────────────────────────────────────────────────────────────────────
def _assert_editable(review: ContractReview) -> None:
    from app.domain.enums import ReviewStatus

    allowed = (ReviewStatus.PENDING_MARKERS.value, ReviewStatus.ECONTRACT_FAILED.value)
    if review.status not in allowed:
        raise ConflictError(
            f"Ticket đang ở trạng thái “{review.status}”, không sửa được luồng ký",
            code="not_pending_markers",
        )


def _assert_owner(principal: Principal, review: ContractReview) -> None:
    from app.domain.enums import UserRole

    if principal.role is not UserRole.IT and principal.user_id != review.owner_id:
        from app.domain.errors import ForbiddenError

        raise ForbiddenError("Chỉ người tạo hợp đồng mới thao tác được luồng ký")


def save_recipients(
    db: Session,
    principal: Principal,
    review: ContractReview,
    recipients: list[dict[str, Any]],
) -> ContractReview:
    """Lưu bước 1 của wizard. Chuẩn hoá id/thứ tự ở server, không tin FE."""
    _assert_owner(principal, review)
    _assert_editable(review)

    cleaned = [r for r in recipients if str(r.get("name") or "") != "__party_shell__"]
    normalized = normalize_flow(cleaned)

    issues = validate_signers(normalized)
    if issues:
        raise ValidationError(
            issues[0].message,
            code=issues[0].code,
            issues=[i.as_dict() for i in issues],
        )

    review.recipients = normalized
    db.flush()
    return review


def normalize_flow(recipients: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Gán lại `p_XXX_r_YYY`, thứ tự bên (mua trước) và thứ tự người trong bên.

    Thứ tự này là **thứ tự ký thật** bên FPT, nên phải do server quyết định.
    Marker được giữ lại chỉ khi người đó vẫn cần marker và loại vẫn khớp hình
    thức ký — đổi từ "Ký ảnh" sang "Chữ ký số" mà giữ marker cũ là lỗi
    `wrongFieldWithRole` khi tới FPT.
    """
    from app.services.econtract.payload import UI_ROLE_ORDER

    flow = signing_recipients(recipients)
    text_markers = [r for r in recipients if str(r.get("markerType") or "") == "st"]

    buckets: dict[str, list[dict[str, Any]]] = {}
    for r in flow:
        party_id = str(r.get("partyId") or ("p_001" if r.get("isMyOrg") else f"p_{r.get('id')}"))
        buckets.setdefault(party_id, []).append(r)

    ordered_parties = sorted(
        buckets.items(),
        key=lambda kv: (
            0 if any(r.get("isMyOrg") for r in kv[1]) else 1,
            min(int(r.get("order") or 99) for r in kv[1]),
            kv[0],
        ),
    )

    out: list[dict[str, Any]] = []
    for party_index, (_, members) in enumerate(ordered_parties):
        party_id = f"p_{party_index + 1:03d}"
        is_my_org = any(r.get("isMyOrg") for r in members)
        org_name = next((str(r.get("orgName") or "") for r in members if r.get("orgName")), "")
        members.sort(
            key=lambda r: (
                UI_ROLE_ORDER.index(normalize_ui_role(r.get("ecRole"))),
                int(r.get("order") or 0),
            )
        )
        for index, source in enumerate(members):
            role = normalize_ui_role(source.get("ecRole"))
            sign_type = _resolve_sign_type(role, source.get("signType"))
            marker_type = marker_type_for(sign_type) or "ds"
            recipient_id = f"{party_id}_r_{index + 1:03d}"

            item = dict(source)
            item.update(
                {
                    "id": recipient_id,
                    "partyId": party_id,
                    "isMyOrg": is_my_org,
                    "role": "company" if is_my_org else "counterparty",
                    "orgName": org_name or str(source.get("orgName") or ""),
                    "partyKind": "organization" if is_my_org else (source.get("partyKind") or None),
                    "order": index + 1,
                    "ecRole": role,
                    "signType": sign_type,
                    "markerType": marker_type,
                }
            )
            item["marker"] = _carry_marker(item, source.get("marker"), marker_type, recipient_id)
            out.append(item)

    return out + text_markers


def _resolve_sign_type(role: str, raw: Any) -> str:
    if role in ("signer", "clerk"):
        value = str(raw or "")
        return value if value and value != "review" else "sign_fca.passcode"
    return "review"


def _carry_marker(
    recipient: dict[str, Any], marker: Any, marker_type: str, recipient_id: str
) -> dict[str, Any] | None:
    if not marker or not isinstance(marker, dict) or not needs_marker(recipient):
        return None
    if str(marker.get("type") or "") != marker_type:
        return None  # đổi hình thức ký ⇒ marker cũ không còn hợp lệ
    return {**marker, "id": f"{marker_type}_{recipient_id}", "type": marker_type}


def update_recipient(
    db: Session,
    principal: Principal,
    review: ContractReview,
    recipient_id: str,
    patch: dict[str, Any],
) -> ContractReview:
    _assert_owner(principal, review)
    _assert_editable(review)

    recipients = list(review.recipients or [])
    target = next((r for r in recipients if str(r.get("id")) == recipient_id), None)
    if target is None:
        raise NotFoundError("Người nhận")

    merged = {**target, **patch}
    # Đổi hình thức ký thì loại marker đổi theo — và marker cũ lệch loại bị gỡ.
    if "signType" in patch:
        marker_type = marker_type_for(merged.get("signType"))
        merged["markerType"] = marker_type or "ds"
        existing = merged.get("marker")
        if not marker_type or (isinstance(existing, dict) and existing.get("type") != marker_type):
            merged["marker"] = None

    review.recipients = [merged if str(r.get("id")) == recipient_id else r for r in recipients]
    db.flush()
    return review


# ─────────────────────────────────────────────────────────────────────────────
# Đặt marker
# ─────────────────────────────────────────────────────────────────────────────
def place_marker(
    db: Session,
    principal: Principal,
    review: ContractReview,
    *,
    recipient_id: str,
    anchor: AnchorRequest,
    sign_type: str | None = None,
    height: int | None = None,
    width: int | None = None,
    size_preset: str | None = None,
) -> ContractReview:
    _assert_owner(principal, review)
    _assert_editable(review)

    recipients = list(review.recipients or [])
    target = next((r for r in recipients if str(r.get("id")) == recipient_id), None)
    if target is None:
        raise NotFoundError("Người nhận")

    merged = dict(target)
    if sign_type:
        merged["signType"] = sign_type
    if not needs_marker(merged):
        raise ValidationError(
            f"{merged.get('name') or recipient_id} không cần marker "
            "— chỉ Người ký chính và Văn thư mới có ô ký",
            code="wrongFieldWithRole",
        )

    marker_type = marker_type_for(merged.get("signType"))
    if not marker_type:
        raise ValidationError("Hình thức ký này không có ô ký", code="wrongFieldWithRole")

    preset = size_preset or (target.get("marker") or {}).get("sizePreset") or "default"
    default_w, default_h = SIZE_PRESETS.get(preset, SIZE_PRESETS["default"])

    resolved, approximated = resolve_anchor(db, review, anchor)

    merged["markerType"] = marker_type
    merged["marker"] = {
        "id": f"{marker_type}_{recipient_id}",
        "type": marker_type,
        "height": int(height or (target.get("marker") or {}).get("height") or default_h),
        "width": int(width or (target.get("marker") or {}).get("width") or default_w),
        "sizePreset": preset,
        "paraId": resolved.para_id,
        "align": anchor.align,
        "position": anchor.position,
        "anchorOrdinal": resolved.ordinal,
        "anchorPreview": resolved.preview,
        "positionLabel": _position_label(resolved),
        "approximated": approximated,
        # Giữ lại gợi ý toạ độ của UI để FE cũ còn vẽ được ô ký lên preview.
        # KHÔNG dùng cho việc ghi file.
        "page": anchor.page,
        "xPct": anchor.x_pct,
        "yPct": anchor.y_pct,
    }

    review.recipients = [merged if str(r.get("id")) == recipient_id else r for r in recipients]
    db.flush()
    return review


def clear_marker(
    db: Session, principal: Principal, review: ContractReview, recipient_id: str
) -> ContractReview:
    _assert_owner(principal, review)
    _assert_editable(review)
    review.recipients = [
        ({**r, "marker": None} if str(r.get("id")) == recipient_id else r)
        for r in (review.recipients or [])
    ]
    db.flush()
    return review


def _position_label(anchor: MarkerAnchor) -> str:
    parts = [p for p in (anchor.numbering_label, anchor.preview) if p]
    return " · ".join(parts) if parts else f"Đoạn #{anchor.ordinal}"


def resolve_anchor(
    db: Session, review: ContractReview, request: AnchorRequest
) -> tuple[MarkerAnchor, bool]:
    """
    `AnchorRequest` → anchor thật trong tài liệu.

    Trả kèm cờ `approximated`. Cờ này bật khi FE chưa gửi `paraId` và ta phải
    suy ra từ `yPct` — vị trí lúc đó **không đúng chỗ người dùng thả**, chỉ là
    xấp xỉ trong khối chữ ký. FE mới phải luôn gửi `paraId` để cờ này tắt.
    """
    anchors = document_anchors(db, review)
    if not anchors:
        raise ConflictError("Tài liệu không có đoạn nào để neo marker", code="no_anchor")

    if request.para_id:
        found = next((a for a in anchors if a.para_id == request.para_id), None)
        if found is None:
            raise ValidationError(
                f"Đoạn neo “{request.para_id}” không còn trong tài liệu — "
                "tài liệu đã đổi, hãy chọn lại vị trí ký",
                code="anchor_not_found",
            )
        return found, False

    pool = [a for a in anchors if a.recommended] or anchors
    ratio = min(max((request.y_pct if request.y_pct is not None else 50.0) / 100.0, 0.0), 1.0)
    index = min(int(ratio * len(pool)), len(pool) - 1)
    log.warning(
        "marker của ticket %s không có paraId — suy ra từ yPct (%.0f%%) → đoạn #%d",
        review.code,
        ratio * 100,
        pool[index].ordinal,
    )
    return pool[index], True


# ─────────────────────────────────────────────────────────────────────────────
# Dựng bản xuất bản để ký
# ─────────────────────────────────────────────────────────────────────────────
def build_placements(review: ContractReview) -> list[MarkerPlacement]:
    placements: list[MarkerPlacement] = []
    for r in signing_recipients(review.recipients or []):
        marker = r.get("marker")
        if not marker:
            continue
        placements.append(
            MarkerPlacement(
                marker_id=str(marker["id"]),
                marker_type=str(marker["type"]),
                recipient_ref=str(r.get("refRecipientId") or r.get("id")),
                height=int(marker.get("height") or 98),
                para_id=str(marker.get("paraId") or ""),
                width_px=int(marker.get("width") or 164),
                align=str(marker.get("align") or "center"),
                position=str(marker.get("position") or "after"),
            )
        )
    return placements


def build_signing_rendition(
    db: Session, principal: Principal | None, review: ContractReview
) -> ReviewFile:
    """
    Sinh bản `.docx` đã chèn marker và lưu thành `ReviewFile(kind="econtract")`.

    **Bản gốc không bị đụng tới.** Chèn marker về mặt kỹ thuật là ghi vào vùng
    khoá, nên nó chỉ được phép tồn tại trên một bản sao dùng để trình ký;
    `insert_markers()` tự hậu kiểm rằng bản sao khác bản gốc đúng ở các đoạn
    marker, không hơn.
    """
    source = current_file(db, review)
    blob = get_storage().get(source.storage_key)

    result = insert_markers(
        blob,
        build_placements(review),
        px_per_space=get_settings().MARKER_PX_PER_SPACE,
    )

    stored = get_storage().put(
        result.document,
        prefix=f"reviews/{review.code}/econtract",
        file_name=source.file_name,
        content_type=source.content_type,
    )
    file_row = ReviewFile(
        review_id=review.id,
        kind="econtract",
        file_name=source.file_name,
        storage_key=stored.key,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        uploaded_by=principal.user_id if principal else None,
    )
    db.add(file_row)
    db.flush()
    return file_row


def assert_ready_to_push(review: ContractReview) -> None:
    issues = validate_markers(review.recipients or [])
    if issues:
        raise ValidationError(
            issues[0].message,
            code=issues[0].code,
            issues=[i.as_dict() for i in issues],
        )


__all__ = [
    "AnchorRequest",
    "anchors_out",
    "assert_ready_to_push",
    "build_placements",
    "build_signing_rendition",
    "clear_marker",
    "current_file",
    "document_anchors",
    "normalize_flow",
    "place_marker",
    "resolve_anchor",
    "save_recipients",
    "update_recipient",
]
