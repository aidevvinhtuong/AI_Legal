"""
Bảng Phân quyền ký — resolve người ký bên mua từ điều kiện cấu hình.

Blueprint §4.3.2. Logic này TỪNG nằm ở client (`config-service.ts` đọc
`localStorage`). Nó quyết định **ai được ký hợp đồng**, nên phải chạy ở server:
một bảng trong trình duyệt thì người dùng sửa được.

Quy tắc khớp:
    intake.businessEntityId ∈ rule.businessEntityIds
    intake.documentCategoryId == rule.documentCategoryId
    rule.minValue ≤ contractValue ≤ rule.maxValue   (maxValue rỗng = không trần)

Sắp xếp: `reviewer` trước `signer`, rồi theo `sortOrder`. Trùng (user, quyền)
thì bỏ bản sau — cùng một người không xuất hiện hai lần trong luồng ký.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import ValidationError
from app.infra.models import SigningAuthorityRule

DEFAULT_SIGN_TYPE = "sign_fca.passcode"
DEFAULT_NOTIFY = ["email_econtract", "sms_econtract"]


@dataclass(frozen=True)
class ResolvedSigningFlow:
    rules: list[SigningAuthorityRule] = field(default_factory=list)
    band_label: str = ""
    recipients: list[dict[str, Any]] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        return bool(self.recipients)


def parse_contract_value(raw: Any) -> Decimal:
    """
    `"1,231,123,123"` / `"1.231.123.123"` / `1231123123` → Decimal.

    Người dùng gõ tiền theo nhiều kiểu; đọc sai một dấu phân cách là chọn nhầm
    bậc ký. Bỏ hết ký tự không phải chữ số rồi mới đọc.
    """
    if raw is None or raw == "":
        raise ValidationError("Chưa nhập Giá trị hợp đồng", code="contract_value_missing")
    if isinstance(raw, (int, float, Decimal)):
        return Decimal(str(raw))

    digits = re.sub(r"[^\d]", "", str(raw))
    if not digits:
        raise ValidationError(
            f"Giá trị hợp đồng “{raw}” không đọc được", code="contract_value_invalid"
        )
    try:
        return Decimal(digits)
    except InvalidOperation as e:  # pragma: no cover — đã lọc ở trên
        raise ValidationError("Giá trị hợp đồng không hợp lệ") from e


def list_rules(db: Session) -> list[SigningAuthorityRule]:
    return list(
        db.execute(
            select(SigningAuthorityRule).order_by(
                SigningAuthorityRule.document_category_id,
                SigningAuthorityRule.min_value,
                SigningAuthorityRule.sort_order,
            )
        ).scalars()
    )


def resolve(db: Session, intake: dict[str, Any], *, org_name: str = "") -> ResolvedSigningFlow:
    """
    Tìm các dòng khớp và dựng danh sách người ký bên mua.

    Trả về flow rỗng (không ném) khi không khớp — người gọi quyết định đó là lỗi
    chặn (lúc Legal duyệt) hay chỉ là thông tin (lúc xem trước).
    """
    category = str(intake.get("documentCategoryId") or "")
    entity = str(intake.get("businessEntityId") or "")
    if not category:
        return ResolvedSigningFlow()

    try:
        value = parse_contract_value(intake.get("contractValue"))
    except ValidationError:
        return ResolvedSigningFlow()

    matched = [
        r
        for r in list_rules(db)
        if r.document_category_id == category
        and (not entity or not r.business_entity_ids or entity in r.business_entity_ids)
        and Decimal(str(r.min_value)) <= value
        and (r.max_value is None or value <= Decimal(str(r.max_value)))
    ]
    if not matched:
        return ResolvedSigningFlow()

    matched.sort(key=lambda r: (0 if r.ec_role == "reviewer" else 1, r.sort_order))

    seen: set[str] = set()
    unique: list[SigningAuthorityRule] = []
    for rule in matched:
        key = f"{rule.ec_role}:{rule.user_id or rule.email}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(rule)

    first = unique[0]
    band = (
        f"≥ {first.min_value:,.0f}"
        if first.max_value is None
        else f"{first.min_value:,.0f} – {first.max_value:,.0f}"
    ).replace(",", ".")

    recipients = [_to_recipient(rule, index, band, org_name) for index, rule in enumerate(unique)]
    return ResolvedSigningFlow(rules=unique, band_label=band, recipients=recipients)


def _to_recipient(
    rule: SigningAuthorityRule, index: int, band: str, org_name: str
) -> dict[str, Any]:
    """Hình dạng `SignRecipient` của FE — wizard eContract dùng lại nguyên."""
    is_signer = rule.ec_role == "signer"
    return {
        "id": f"p_001_r_{index + 1:03d}",
        "partyId": "p_001",
        "name": rule.personal_name,
        "role": "company",
        "orgName": org_name or "Saint-Gobain Vietnam",
        "isMyOrg": True,
        "partyKind": "organization",
        "order": index + 1,
        "email": rule.email,
        "phone": rule.telephone_number,
        "userId": str(rule.user_id) if rule.user_id else None,
        "notifyTypes": list(DEFAULT_NOTIFY),
        "ecRole": "signer" if is_signer else "reviewer",
        "signType": (rule.sign_type or DEFAULT_SIGN_TYPE) if is_signer else "review",
        # LUÔN là "ds" — kể cả người xem xét (họ chỉ không có `marker`).
        # `"st"` là marker text-cần-điền, KHÔNG phải một người trong luồng ký:
        # `groupRecipientsByParty` của FE bỏ qua mọi recipient `markerType="st"`,
        # nên gán "st" cho reviewer là làm họ biến mất khỏi payload gửi FPT.
        "markerType": "ds",
        "signingMatrixBandLabel": band,
    }


def readiness_error(flow: ResolvedSigningFlow) -> str | None:
    """
    Vì sao chưa duyệt được. Trả `None` nghĩa là sẵn sàng.

    Thông báo phải chỉ đúng chỗ IT cần sửa: Legal bị chặn bởi một bảng mà Legal
    không quản, nên nói mơ hồ là ticket kẹt không ai gỡ.
    """
    if not flow.recipients:
        return (
            "Chưa có dòng Phân quyền ký khớp Công ty / Loại hợp đồng / Giá trị hợp đồng — "
            "đề nghị IT bổ sung tại Configurations → Phân quyền ký"
        )
    if not any(r["ecRole"] == "signer" for r in flow.recipients):
        return "Ma trận khớp điều kiện nhưng thiếu người Ký chính (signer)"
    missing_email = [r["name"] or "(chưa có tên)" for r in flow.recipients if not r["email"]]
    if missing_email:
        return f"Thiếu email của: {', '.join(missing_email)} — eContract bắt buộc có email"
    return None
