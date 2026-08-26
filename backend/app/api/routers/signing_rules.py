"""
Bảng Phân quyền ký eContract (Blueprint §4.3.2).

Logic resolve nằm ở `services/config/signing.py`. Router chỉ CRUD và trả bản
xem trước — nhưng đây là dữ liệu quyết định **ai được ký hợp đồng**, nên đọc
cũng cần quyền `contract_config`, không mở cho mọi người đăng nhập.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from app.api.deps import CurrentUser, DbSession, require
from app.domain.enums import Permission
from app.domain.errors import ValidationError
from app.infra.models import AuditLog, SigningAuthorityRule
from app.services.config import signing

router = APIRouter(
    prefix="/api/v1/signing-rules",
    tags=["signing-rules"],
    dependencies=[Depends(require(Permission.CONTRACT_CONFIG))],
)

VALID_ROLES = {"reviewer", "signer"}


def _out(rule: SigningAuthorityRule) -> dict[str, Any]:
    return {
        "id": str(rule.id),
        "businessEntityIds": list(rule.business_entity_ids or []),
        "documentCategoryId": rule.document_category_id,
        "minValue": float(rule.min_value),
        "maxValue": float(rule.max_value) if rule.max_value is not None else None,
        "ecRole": rule.ec_role,
        "userId": str(rule.user_id) if rule.user_id else None,
        "personalName": rule.personal_name,
        "email": rule.email,
        "telephoneNumber": rule.telephone_number,
        "signType": rule.sign_type,
        "order": rule.sort_order,
    }


class RuleIn(BaseModel):
    id: str | None = None
    businessEntityIds: list[str] = Field(default_factory=list)  # noqa: N815
    documentCategoryId: str = Field(min_length=1)  # noqa: N815
    minValue: float = 0  # noqa: N815
    maxValue: float | None = None  # noqa: N815
    ecRole: str  # noqa: N815
    userId: str | None = None  # noqa: N815
    personalName: str = ""  # noqa: N815
    email: str = ""
    telephoneNumber: str = ""  # noqa: N815
    signType: str | None = None  # noqa: N815
    order: int = 0

    @field_validator("ecRole")
    @classmethod
    def _role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError("Quyền phải là 'reviewer' (Xem xét) hoặc 'signer' (Ký chính)")
        return v


class RulesIn(BaseModel):
    rules: list[RuleIn]


@router.get("")
def list_rules(principal: CurrentUser, db: DbSession) -> list[dict[str, Any]]:
    del principal
    return [_out(r) for r in signing.list_rules(db)]


@router.put("")
def save_rules(payload: RulesIn, principal: CurrentUser, db: DbSession) -> list[dict[str, Any]]:
    """
    Lưu nguyên bảng. Đây là bảng phẳng do người dùng sửa trực tiếp trên lưới,
    số dòng nhỏ, nên ghi đè cả bảng đơn giản và đúng ý người dùng hơn là diff
    từng dòng.
    """
    _validate(payload.rules)

    old = [_out(r) for r in signing.list_rules(db)]
    db.query(SigningAuthorityRule).delete()

    for index, item in enumerate(payload.rules):
        db.add(
            SigningAuthorityRule(
                business_entity_ids=item.businessEntityIds,
                document_category_id=item.documentCategoryId,
                min_value=item.minValue,
                max_value=item.maxValue,
                ec_role=item.ecRole,
                user_id=uuid.UUID(item.userId) if item.userId else None,
                personal_name=item.personalName,
                email=item.email,
                telephone_number=item.telephoneNumber,
                sign_type=item.signType,
                sort_order=item.order or index,
            )
        )

    db.add(
        AuditLog(
            actor_id=principal.user_id,
            actor_name=principal.username,
            actor_role=principal.role.value,
            action="save_signing_matrix",
            entity_type="signing_rules",
            entity_id="all",
            old_value={"count": len(old)},
            new_value={"count": len(payload.rules)},
        )
    )
    db.flush()
    return [_out(r) for r in signing.list_rules(db)]


class PreviewIn(BaseModel):
    documentCategoryId: str  # noqa: N815
    businessEntityId: str | None = None  # noqa: N815
    contractValue: str | float  # noqa: N815


@router.post("/preview")
def preview(payload: PreviewIn, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Thử một tổ hợp điều kiện xem ra ai — để IT kiểm bảng trước khi Legal gặp
    lỗi "không có dòng nào khớp" lúc đang duyệt.
    """
    del principal
    flow = signing.resolve(
        db,
        {
            "documentCategoryId": payload.documentCategoryId,
            "businessEntityId": payload.businessEntityId,
            "contractValue": payload.contractValue,
        },
    )
    return {
        "ready": signing.readiness_error(flow) is None,
        "reason": signing.readiness_error(flow),
        "bandLabel": flow.band_label,
        "recipients": flow.recipients,
    }


def _validate(rules: list[RuleIn]) -> None:
    for index, rule in enumerate(rules, start=1):
        # `userId` đi thẳng vào `uuid.UUID(...)` lúc ghi. Không kiểm ở đây thì
        # một id rác (vd. id tạm do FE sinh) ném ValueError giữa transaction và
        # người dùng nhận 500 thay vì một câu nói rõ dòng nào sai.
        if rule.userId:
            try:
                uuid.UUID(rule.userId)
            except ValueError:
                raise ValidationError(
                    f"Dòng {index}: Người ký chưa được chọn từ danh sách tài khoản",
                    code="invalid_user_id",
                ) from None
        if rule.maxValue is not None and rule.maxValue < rule.minValue:
            raise ValidationError(
                f"Dòng {index}: Giá trị max nhỏ hơn min", code="invalid_value_band"
            )
        if not rule.email and rule.ecRole == "signer":
            raise ValidationError(
                f"Dòng {index}: Người Ký chính bắt buộc có email — eContract yêu cầu",
                code="signer_email_required",
            )
