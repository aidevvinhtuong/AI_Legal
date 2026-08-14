"""Đăng nhập, đổi mật khẩu, phiên hiện tại."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.api.presenters import session_out, user_out
from app.domain.enums import DEFAULT_PERMISSIONS, UserRole
from app.domain.errors import ForbiddenError, UnauthorizedError, ValidationError
from app.infra.models import AuditLog, User
from app.services.identity.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class ChangePasswordIn(BaseModel):
    username: str = Field(min_length=1)
    oldPassword: str = Field(min_length=1)  # noqa: N815 — khớp payload FE
    newPassword: str = Field(min_length=4)  # noqa: N815


def _effective_permissions(user: User) -> list[str]:
    if user.permissions:
        return list(user.permissions)
    try:
        return sorted(p.value for p in DEFAULT_PERMISSIONS[UserRole(user.role)])
    except (ValueError, KeyError):
        return []


def _find(db, username: str) -> User | None:
    return db.execute(
        select(User).where(func.lower(User.username) == username.strip().lower())
    ).scalar_one_or_none()


@router.post("/login")
def login(payload: LoginIn, db: DbSession) -> dict[str, Any]:
    user = _find(db, payload.username)

    # Cùng một thông báo cho "sai tài khoản" và "sai mật khẩu" — không giúp
    # người dò biết username nào có thật.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise UnauthorizedError("Tài khoản hoặc mật khẩu không đúng")
    if not user.active:
        raise ForbiddenError("Tài khoản đã bị vô hiệu hoá")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)

    permissions = _effective_permissions(user)
    token = create_access_token(
        user_id=user.id, username=user.username, role=user.role, permissions=permissions
    )
    db.add(
        AuditLog(
            actor_id=user.id,
            actor_name=user.username,
            actor_role=user.role,
            action="login",
            entity_type="user",
            entity_id=str(user.id),
        )
    )
    return session_out(user, token, permissions)


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, db: DbSession) -> dict[str, Any]:
    """
    Tự đổi mật khẩu ở màn /login — không cần phiên đăng nhập (Blueprint §1.3.2).

    Vẫn bắt buộc đúng mật khẩu cũ, nên không thành đường đổi mật khẩu người khác.
    """
    user = _find(db, payload.username)
    if user is None or not verify_password(payload.oldPassword, user.password_hash):
        raise UnauthorizedError("Tài khoản hoặc mật khẩu cũ không đúng")
    if not user.active:
        raise ForbiddenError("Tài khoản đã bị vô hiệu hoá")
    if payload.newPassword == payload.oldPassword:
        raise ValidationError("Mật khẩu mới phải khác mật khẩu cũ")

    user.password_hash = hash_password(payload.newPassword)
    db.add(
        AuditLog(
            actor_id=user.id,
            actor_name=user.username,
            actor_role=user.role,
            action="password_changed",
            entity_type="user",
            entity_id=str(user.id),
        )
    )
    return {"ok": True}


@router.get("/me")
def me(principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Nguồn sự thật của phiên. FE nên gọi endpoint này thay vì tin `localStorage`:
    IT thu quyền là có hiệu lực ngay ở lần gọi kế tiếp.
    """
    user = db.get(User, principal.user_id)
    if user is None:
        raise UnauthorizedError()
    return {**user_out(user), "permissions": _effective_permissions(user)}
