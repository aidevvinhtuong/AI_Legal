"""Quản lý tài khoản và phân quyền (IT)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, require
from app.api.presenters import user_directory_out, user_out
from app.domain.enums import Permission, UserRole
from app.domain.errors import ConflictError, NotFoundError, ValidationError
from app.infra.models import ContractReview, User
from app.services.identity.security import hash_password

# Guard đặt ở TỪNG route, không ở router.
#
# Quản trị tài khoản là việc của IT (`users`), nhưng bảng Phân quyền ký của
# Legal cần đọc được danh sách người để chọn người ký. Guard cấp router là AND
# với guard cấp route, nên không nới lỏng riêng một route được — phải tách.
router = APIRouter(prefix="/api/v1/users", tags=["users"])

ADMIN = Depends(require(Permission.USERS))
# `require` là OR: đủ MỘT trong hai quyền là qua.
DIRECTORY = Depends(require(Permission.USERS, Permission.CONTRACT_CONFIG))

VALID_PERMISSIONS = {p.value for p in Permission}
VALID_ROLES = {r.value for r in UserRole}
VALID_DEPARTMENTS = {"Purchasing", "IT", "Legal"}


class UserIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    fullName: str = Field(default="", max_length=200)  # noqa: N815
    password: str | None = None
    email: str = ""
    phone: str = ""
    department: str = "Purchasing"
    role: str
    lineManagerId: str | None = None  # noqa: N815
    permissions: list[str] = Field(default_factory=list)
    active: bool = True

    @field_validator("role")
    @classmethod
    def _role_supported(cls, v: str) -> str:
        if v not in VALID_ROLES:
            # `legal_lead` đã bỏ từ Blueprint v1.8; giữ chặn phòng session cũ
            raise ValueError(f"Vai trò “{v}” không được hỗ trợ ({', '.join(sorted(VALID_ROLES))})")
        return v

    @field_validator("department")
    @classmethod
    def _department_supported(cls, v: str) -> str:
        if v not in VALID_DEPARTMENTS:
            raise ValueError(f"Bộ phận “{v}” không hợp lệ")
        return v

    @field_validator("permissions")
    @classmethod
    def _permissions_known(cls, v: list[str]) -> list[str]:
        unknown = sorted(set(v) - VALID_PERMISSIONS)
        if unknown:
            raise ValueError(f"Quyền không tồn tại: {', '.join(unknown)}")
        return v


@router.get("/directory", dependencies=[DIRECTORY])
def user_directory(db: DbSession) -> list[dict[str, Any]]:
    """
    Danh bạ để chọn người ký — chỉ tên, email, điện thoại, còn hoạt động không.

    Khai TRƯỚC `/{user_id}` không cần thiết ở đây (route này là GET, các route
    có `{user_id}` là PUT/DELETE), nhưng giữ thứ tự này để sau có thêm
    `GET /{user_id}` thì `/directory` không bị nuốt làm tham số.
    """
    rows = db.execute(select(User).where(User.active.is_(True)).order_by(User.username)).scalars()
    return [user_directory_out(u) for u in rows]


@router.get("", dependencies=[ADMIN])
def list_users(db: DbSession) -> list[dict[str, Any]]:
    rows = db.execute(select(User).order_by(User.username)).scalars()
    return [user_out(u) for u in rows]


@router.post("", status_code=201, dependencies=[ADMIN])
def create_user(payload: UserIn, db: DbSession) -> dict[str, Any]:
    if not payload.password:
        raise ValidationError("Phải đặt mật khẩu khi tạo tài khoản mới")
    _assert_username_free(db, payload.username)

    user = User(
        username=payload.username.strip(),
        full_name=payload.fullName,
        password_hash=hash_password(payload.password),
        email=payload.email,
        phone=payload.phone,
        department=payload.department,
        role=payload.role,
        line_manager_id=_parse_manager(db, payload.lineManagerId, None),
        permissions=payload.permissions,
        active=payload.active,
    )
    db.add(user)
    db.flush()
    return user_out(user)


@router.put("/{user_id}", dependencies=[ADMIN])
def update_user(user_id: uuid.UUID, payload: UserIn, db: DbSession) -> dict[str, Any]:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("Tài khoản")

    if payload.username.strip().lower() != user.username.lower():
        _assert_username_free(db, payload.username)
        user.username = payload.username.strip()

    user.full_name = payload.fullName
    user.email = payload.email
    user.phone = payload.phone
    user.department = payload.department
    user.role = payload.role
    user.line_manager_id = _parse_manager(db, payload.lineManagerId, user.id)
    user.permissions = payload.permissions
    user.active = payload.active
    # Để trống ⇒ giữ nguyên mật khẩu cũ, không đặt lại thành rỗng
    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.flush()
    return user_out(user)


@router.delete("/{user_id}", dependencies=[ADMIN])
def delete_user(user_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Chặn xoá khi tài khoản còn ràng buộc dữ liệu.

    Xoá cứng một user đang sở hữu hợp đồng sẽ làm mất dấu vết ai tạo cái gì —
    trong hệ thống pháp chế thì đó là mất bằng chứng. Vô hiệu hoá là đủ.
    """
    if user_id == principal.user_id:
        raise ConflictError("Không thể tự xoá tài khoản của chính mình")

    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("Tài khoản")

    owned = db.query(ContractReview).filter(ContractReview.owner_id == user.id).count()
    if owned:
        raise ConflictError(
            f"Tài khoản đang sở hữu {owned} hợp đồng — hãy chuyển sang Không hoạt động thay vì xoá",
            code="user_has_reviews",
            reviewCount=owned,
        )

    subordinates = db.query(User).filter(User.line_manager_id == user.id).count()
    if subordinates:
        raise ConflictError(
            f"Còn {subordinates} tài khoản đang nhận người này làm Line Manager",
            code="user_is_line_manager",
        )

    db.delete(user)
    db.flush()
    return {"ok": True}


def _assert_username_free(db, username: str) -> None:
    existing = db.execute(
        select(User).where(func.lower(User.username) == username.strip().lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Tài khoản “{username}” đã tồn tại")


def _parse_manager(db, raw: str | None, self_id: uuid.UUID | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        manager_id = uuid.UUID(raw)
    except ValueError as e:
        raise ValidationError("Line Manager không hợp lệ") from e
    if self_id and manager_id == self_id:
        raise ValidationError("Không thể đặt chính mình làm Line Manager")
    if db.get(User, manager_id) is None:
        raise ValidationError("Line Manager không tồn tại")
    return manager_id
