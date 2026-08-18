"""
Dựng payload `excall` gửi FPT.eContract (API 3.1.2).

Cấu trúc bám `docs/requirements-alignment/07-econtract-integration.md` mục 2.2,
và giữ nguyên hình dạng mà `frontend/src/lib/econtract-flow.ts` đã dựng — FE đã
đối chiếu với ví dụ request trong tài liệu FPT.

Hai khác biệt có chủ đích so với bản FE:

  1. **`fileName` giữ đuôi `.docx`.** Bản FE đổi sang `.pdf` từ thời còn định
     convert. FPT đã xác nhận nhận `.docx` dạng base64 nên đổi đuôi chỉ làm
     nhầm lẫn khi đối soát.
  2. **`selector` / `docTypeCode` đọc từ settings của server**, không nhận từ
     request. Đây là cấu hình tích hợp, không phải dữ liệu người dùng.
"""

from __future__ import annotations

from typing import Any

from app.services.econtract.validation import (
    api_role,
    api_sign_types,
    normalize_ui_role,
    signing_recipients,
)

DEFAULT_NOTIFY = ["email_econtract", "sms_econtract"]
UI_ROLE_ORDER = ("coordinator", "reviewer", "signer", "clerk", "cc")


def resolve_contact_id(recipient: dict[str, Any]) -> str:
    """Nhập tay → username hệ thống → local-part email → id. Giống hệt FE."""
    manual = str(recipient.get("contactId") or "").strip()
    if manual:
        return manual
    username = str(recipient.get("username") or "").strip()
    if username:
        return username
    email = str(recipient.get("email") or "").strip()
    if "@" in email:
        local = "".join(c for c in email.split("@")[0] if c.isalnum() or c in "._-")
        if local:
            return local
    rid = str(recipient.get("id") or "")
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in rid)


def normalize_notify(types: Any) -> list[str]:
    allowed = set(DEFAULT_NOTIFY)
    values = [t for t in (types or []) if t in allowed]
    return list(dict.fromkeys(values)) or list(DEFAULT_NOTIFY)


def _discount_label(flag: Any) -> str:
    return {"yes": "Có - Yes", "no": "Không - No"}.get(str(flag or ""), "")


def build_header_fields(review_code: str, title: str, intake: dict[str, Any]) -> list[dict]:
    """
    `headerFields` phải khớp cấu hình loại tài liệu trên cổng FPT (câu hỏi D1b).

    Giữ đủ 8 trường kể cả khi rỗng: FPT khớp theo `id`, thiếu trường thì cổng
    báo lỗi cấu hình chứ không tự bỏ qua.
    """
    return [
        {
            "id": "envName",
            "name": "Tên tài liệu",
            "type": "String",
            "value": str(intake.get("documentName") or title or review_code),
        },
        {
            "id": "envNo",
            "name": "Số tài liệu",
            "type": "String",
            "value": str(intake.get("documentNumber") or review_code),
        },
        {
            "id": "envDate",
            "name": "Ngày ký",
            "type": "Date",
            "value": str(intake.get("signingDate") or ""),
        },
        {
            "id": "envSubmittedFrom",
            "name": "Đơn vị tạo yêu cầu",
            "type": "String",
            "value": str(intake.get("businessEntityLabel") or ""),
        },
        {
            "id": "envF00",
            "name": "Loại hợp đồng",
            "type": "String",
            "value": str(intake.get("documentCategoryLabel") or ""),
        },
        {
            "id": "envF01",
            "name": "Hợp đồng có chiết khấu",
            "type": "String",
            "value": _discount_label(intake.get("hasDiscount")),
        },
        {
            "id": "envF02",
            "name": "Chi tiết chiết khấu",
            "type": "String",
            "value": str(intake.get("discountDetails") or ""),
        },
        {
            "id": "envF03",
            "name": "Giá trị hợp đồng",
            "type": "Number",
            "value": "".join(ch for ch in str(intake.get("contractValue") or "0") if ch.isdigit())
            or "0",
        },
    ]


def build_parties(recipients: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Nhóm theo bên, bên mua trước, trong bên theo thứ tự hiển thị trên UI.

    Thứ tự này CHÍNH LÀ thứ tự ký bên FPT — không phải chi tiết trình bày.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for r in signing_recipients(recipients):
        party_id = str(r.get("partyId") or ("p_001" if r.get("isMyOrg") else f"p_{r.get('id')}"))
        bucket = buckets.setdefault(
            party_id,
            {
                "id": party_id,
                "isMyOrg": bool(r.get("isMyOrg")),
                "orgName": "",
                "partyKind": r.get("partyKind"),
                "order": int(r.get("order") or 99),
                "recipients": [],
            },
        )
        bucket["recipients"].append(r)
        if r.get("orgName"):
            bucket["orgName"] = str(r["orgName"])
        if not bucket["isMyOrg"] and r.get("partyKind"):
            bucket["partyKind"] = r["partyKind"]

    ordered = sorted(
        buckets.values(), key=lambda b: (0 if b["isMyOrg"] else 1, b["order"], b["id"])
    )

    out: list[dict[str, Any]] = []
    for index, bucket in enumerate(ordered):
        members = sorted(
            bucket["recipients"],
            key=lambda r: (
                UI_ROLE_ORDER.index(normalize_ui_role(r.get("ecRole"))),
                int(r.get("order") or 0),
            ),
        )
        out.append(
            {
                "id": bucket["id"],
                "isMyOrg": bucket["isMyOrg"],
                "isOrg": True if bucket["isMyOrg"] else bucket["partyKind"] != "individual",
                "orgName": bucket["orgName"],
                "order": index + 1,
                "recipients": [
                    {
                        "isEsign": False,
                        "recipientId": str(r.get("id") or ""),
                        "email": str(r.get("email") or ""),
                        "personalName": str(r.get("name") or ""),
                        "telephoneNumber": str(r.get("phone") or ""),
                        "contactId": resolve_contact_id(r),
                        "role": api_role(r.get("ecRole")),
                        "order": position + 1,
                        "notifyTypes": normalize_notify(r.get("notifyTypes")),
                        "signTypes": api_sign_types(r.get("signType")),
                    }
                    for position, r in enumerate(members)
                ],
            }
        )
    return out


def build_excall_payload(
    *,
    review_code: str,
    title: str,
    file_name: str,
    intake: dict[str, Any],
    recipients: list[dict[str, Any]],
    file_base64: str,
    selector: str,
    doc_type_code: int,
) -> dict[str, Any]:
    """`refId` = `lookup` = `review.code` — khoá idempotency của cả hai hệ thống."""
    return {
        "id": "",
        "refId": review_code,
        "selector": selector,
        "lookup": review_code,
        "attrs": None,
        "payload": None,
        "body": {
            "alias": "",
            "refId": review_code,
            "file": file_base64,
            "fileName": file_name,
            "docTypeCode": doc_type_code,
            "headerFields": build_header_fields(review_code, title, intake),
            "parties": build_parties(recipients),
        },
    }


def redact(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Bản để ghi log / lưu outbox: bỏ base64 của hợp đồng.

    Nội dung điều khoản không bao giờ được nằm trong log (quy ước log ở
    `backend/CLAUDE.md` mục 5).
    """
    import copy

    safe = copy.deepcopy(payload)
    body = safe.get("body") or {}
    if "file" in body:
        body["file"] = f"<base64 {len(payload['body']['file'])} ký tự>"
    return safe


__all__ = [
    "build_excall_payload",
    "build_header_fields",
    "build_parties",
    "redact",
    "resolve_contact_id",
]
