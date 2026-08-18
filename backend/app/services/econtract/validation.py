"""
Validate luồng ký và marker — **lần thứ hai, ở server**.

FE đã có `validateMarkers()` và người dùng thấy lỗi ngay trên UI. Tầng này vẫn
chạy lại toàn bộ, vì hai lý do:

  1. FE có thể bị bypass (gọi thẳng API). Marker sai gửi lên FPT sẽ bị từ chối
     ở đó, nhưng lúc ấy hợp đồng đã rời hệ thống và lỗi hiện ra bằng tiếng Anh.
  2. Dùng **đúng bộ mã lỗi của FPT** nên thông báo cho người dùng giống hệt
     nhau dù lỗi bị chặn ở FE, ở đây, hay tận bên FPT.

Toàn bộ luật lấy từ `docs/requirements-alignment/07-econtract-integration.md`
mục 1.1–1.2 và `Hướng-dẫn-cấu_trúc-đánh-dấu-marker.docx`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.econtract.errors import translate

# Vai trò trên UI wizard → có cần marker không (mục 1.2 của tài liệu tích hợp).
MARKER_ROLES = frozenset({"signer", "clerk"})
NO_MARKER_ROLES = frozenset({"coordinator", "reviewer", "cc"})

SIGN_TYPE_TO_MARKER: dict[str, str | None] = {
    "review": None,
    "sign_img": "is",
    "sign_ekyc": "ds",
    "sign_fca.passcode": "ds",
    "sign_fca.otp": "ds",
}

SIGN_TYPE_TO_API: dict[str, list[str]] = {
    "review": [],
    "sign_img": ["Sign-IMG"],
    "sign_ekyc": ["sign_ekyc", "sign_fca.otp"],
    "sign_fca.passcode": ["sign_fca.passcode"],
    "sign_fca.otp": ["sign_fca.otp"],
}


@dataclass(frozen=True)
class MarkerIssue:
    """Một lỗi. `code` là mã FPT khi có, để FE hiển thị thống nhất."""

    code: str
    message: str
    recipient_id: str = ""

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message, "recipientId": self.recipient_id}


def normalize_ui_role(role: Any) -> str:
    value = str(role or "").strip()
    return value if value in MARKER_ROLES | NO_MARKER_ROLES else "signer"


def marker_type_for(sign_type: Any) -> str | None:
    return SIGN_TYPE_TO_MARKER.get(str(sign_type or "sign_fca.passcode"), "ds")


def api_sign_types(sign_type: Any) -> list[str]:
    return list(SIGN_TYPE_TO_API.get(str(sign_type or ""), []))


def api_role(ui_role: Any) -> str:
    """FPT chỉ có hai vai trò tài liệu. Văn thư đóng dấu vẫn là người ký."""
    return "signer" if normalize_ui_role(ui_role) in MARKER_ROLES else "reviewer"


def needs_marker(recipient: dict[str, Any]) -> bool:
    if str(recipient.get("markerType") or "") == "st":
        return False
    if str(recipient.get("signType") or "") == "review":
        return False
    return normalize_ui_role(recipient.get("ecRole")) in MARKER_ROLES


def signing_recipients(recipients: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bỏ marker text-cần-điền: chúng không phải người trong luồng ký."""
    return [r for r in recipients if str(r.get("markerType") or "") != "st"]


# ─────────────────────────────────────────────────────────────────────────────
# Bước 1 — người ký
# ─────────────────────────────────────────────────────────────────────────────
def validate_signers(recipients: list[dict[str, Any]]) -> list[MarkerIssue]:
    """Đủ điều kiện chuyển sang bước Thiết kế (kéo-thả marker) chưa."""
    issues: list[MarkerIssue] = []
    flow = signing_recipients(recipients)

    if not flow:
        return [MarkerIssue("isNotExistsRecipientInfo", "Chưa có người nhận nào trong luồng ký")]

    parties: dict[str, list[dict[str, Any]]] = {}
    for r in flow:
        parties.setdefault(str(r.get("partyId") or "p_001"), []).append(r)

    if not any(any(r.get("isMyOrg") for r in group) for group in parties.values()):
        issues.append(MarkerIssue("isNotExistsIndividual", "Thiếu bên ký của công ty (bên mua)"))
    if not any(not any(r.get("isMyOrg") for r in group) for group in parties.values()):
        issues.append(MarkerIssue("isNotExistsIndividual", "Chưa thêm bên ký đối tác"))

    for party_id, group in parties.items():
        is_my_org = any(r.get("isMyOrg") for r in group)
        org_name = next((str(r.get("orgName") or "") for r in group if r.get("orgName")), "")
        if not org_name.strip():
            issues.append(
                MarkerIssue(
                    "isNotExistsIndividual",
                    f"Thiếu tên tổ chức / cá nhân của bên {party_id}",
                )
            )
        if not is_my_org:
            kind = str(group[0].get("partyKind") or "")
            if kind not in ("organization", "individual"):
                issues.append(
                    MarkerIssue(
                        "isNotExistsIndividual",
                        f"Bên đối tác {org_name or party_id}: bắt buộc chọn Tổ chức hoặc Cá nhân",
                    )
                )
        if not any(normalize_ui_role(r.get("ecRole")) == "signer" for r in group):
            issues.append(
                MarkerIssue(
                    "isNotExistsMarkerField",
                    f"{org_name or party_id}: cần ít nhất một Người ký chính",
                    recipient_id=party_id,
                )
            )

    issues.extend(_validate_contact_info(flow))
    return issues


def _validate_contact_info(flow: list[dict[str, Any]]) -> list[MarkerIssue]:
    issues: list[MarkerIssue] = []
    for r in flow:
        rid = str(r.get("id") or "")
        label = str(r.get("name") or "").strip()
        if not r.get("ecRole"):
            issues.append(
                MarkerIssue(
                    "recipientRoleIsNull",
                    f"{translate('recipientRoleIsNull')}: {label or rid}",
                    rid,
                )
            )
        if not label:
            issues.append(
                MarkerIssue("isNotExistsRecipientInfo", f"Thiếu họ tên người nhận {rid}", rid)
            )
        if "@" not in str(r.get("email") or ""):
            issues.append(
                MarkerIssue(
                    "isNotExistsRecipientInfo",
                    f"{translate('isNotExistsRecipientInfo')}: {label or rid}",
                    rid,
                )
            )
        if not str(r.get("orgName") or "").strip():
            issues.append(
                MarkerIssue(
                    "isNotExistsIndividual",
                    f"{translate('isNotExistsIndividual')}: {label or rid}",
                    rid,
                )
            )
    return issues


# ─────────────────────────────────────────────────────────────────────────────
# Bước 2 — marker
# ─────────────────────────────────────────────────────────────────────────────
def validate_markers(recipients: list[dict[str, Any]]) -> list[MarkerIssue]:
    """Đủ điều kiện Submit sang FPT chưa. Rỗng nghĩa là đạt."""
    issues = list(_validate_contact_info(signing_recipients(recipients)))
    seen_marker_ids: set[str] = set()
    marker_count = 0

    for r in signing_recipients(recipients):
        rid = str(r.get("id") or "")
        label = str(r.get("name") or "").strip() or rid
        marker = r.get("marker") or None

        if not needs_marker(r):
            if marker:
                issues.append(
                    MarkerIssue(
                        "wrongFieldWithRole",
                        f"{label} ({normalize_ui_role(r.get('ecRole'))}) không được gán marker",
                        rid,
                    )
                )
            continue

        if not marker:
            issues.append(
                MarkerIssue(
                    "isNotExistsMarkerField",
                    f"Chưa đặt vị trí ký cho {label}",
                    rid,
                )
            )
            continue

        marker_count += 1
        issues.extend(_validate_one_marker(r, marker, rid, label, seen_marker_ids))

    if marker_count == 0:
        issues.append(MarkerIssue("isNotExistsMarkerField", translate("isNotExistsMarkerField")))
    return issues


def _validate_one_marker(
    recipient: dict[str, Any],
    marker: dict[str, Any],
    rid: str,
    label: str,
    seen: set[str],
) -> list[MarkerIssue]:
    issues: list[MarkerIssue] = []
    marker_id = str(marker.get("id") or "")

    if not marker_id:
        issues.append(MarkerIssue("isNotExistsMarkerField", f"Marker của {label} thiếu id", rid))
    elif marker_id in seen:
        # Ràng buộc C-8: id marker phải duy nhất trong toàn file. Trùng id là
        # đúng ca `tooManyMarkerDigitalField` của FPT.
        issues.append(
            MarkerIssue(
                "tooManyMarkerDigitalField",
                f"Marker id “{marker_id}” bị dùng cho nhiều người ký",
                rid,
            )
        )
    seen.add(marker_id)

    if not str(marker.get("paraId") or "").strip():
        issues.append(
            MarkerIssue(
                "isNotExistsMarkerField",
                f"Marker của {label} chưa neo vào đoạn nào trong tài liệu",
                rid,
            )
        )

    try:
        height = int(marker.get("height") or 0)
    except (TypeError, ValueError):
        height = 0
    if height <= 0:
        issues.append(MarkerIssue("wrongFieldWithRole", f"Marker của {label}: h phải > 0", rid))

    expected = marker_type_for(recipient.get("signType"))
    actual = str(marker.get("type") or "")
    if expected and actual != expected:
        issues.append(
            MarkerIssue(
                "wrongFieldWithRole",
                f"{label}: marker “{actual}” không khớp hình thức ký “{recipient.get('signType')}”",
                rid,
            )
        )
    return issues


def first_message(issues: list[MarkerIssue]) -> str:
    return issues[0].message if issues else ""


__all__ = [
    "MARKER_ROLES",
    "MarkerIssue",
    "api_role",
    "api_sign_types",
    "first_message",
    "marker_type_for",
    "needs_marker",
    "normalize_ui_role",
    "signing_recipients",
    "validate_markers",
    "validate_signers",
]
