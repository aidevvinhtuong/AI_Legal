"""Đăng nhập, đổi mật khẩu, phiên hiện tại."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import AccessClaims, CurrentUser, DbSession
from app.api.presenters import session_out, user_out
from app.domain.enums import DEFAULT_PERMISSIONS, UserRole
from app.domain.errors import ForbiddenError, UnauthorizedError, ValidationError
from app.infra.models import AuditLog, User
from app.services.identity.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    session_deadline,
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
    # `sessionExpiresAt` = trần TUYỆT ĐỐI của phiên, không phải hạn của token.
    # FE cần nó để biết khi nào gia hạn cũng vô ích mà báo trước cho người dùng,
    # thay vì để họ đang gõ thì màn hình nhảy về /login.
    return {
        **session_out(user, token, permissions),
        "sessionExpiresAt": session_deadline({"lgn": int(datetime.now(timezone.utc).timestamp())})
        .isoformat(),
    }


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


@router.post("/refresh")
def refresh(claims: AccessClaims, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Gia hạn phiên — **phiên trượt, có trần tuyệt đối**.

    Vì sao cần: token sống 30 phút tính từ lúc ĐĂNG NHẬP, không phải từ thao tác
    cuối. Trước endpoint này, người dùng đang gõ dở cũng bị đá ra ở phút thứ 31,
    và vì quy tắc A4c bắt **lưu thủ công** nên phần chưa lưu mất trắng. Đó mới là
    cái giá thật, không phải sự phiền toái.

    Vì sao vẫn có trần: `REFRESH_TOKEN_HOURS` kể từ lần nhập mật khẩu gốc (`lgn`,
    giữ nguyên qua mọi lần gia hạn). Người đang làm việc không bao giờ bị ngắt;
    một máy trạm bỏ quên thì vẫn hết phiên. Thiếu trần này thì "phiên trượt" biến
    thành "phiên vĩnh viễn".

    Không cần refresh token riêng: token hiện tại **còn hiệu lực** mới gọi được
    endpoint này (dependency đã decode và kiểm `exp`). Hết hạn rồi thì đăng nhập
    lại — đúng ý nghĩa của hết phiên.
    """
    deadline = session_deadline(claims)
    now = datetime.now(timezone.utc)
    if now >= deadline:
        raise UnauthorizedError(
            "Phiên đã đạt thời hạn tối đa, vui lòng đăng nhập lại"
        )

    user = db.get(User, principal.user_id)
    if user is None:
        raise UnauthorizedError()
    if not user.active:
        raise ForbiddenError("Tài khoản đã bị vô hiệu hoá")

    permissions = _effective_permissions(user)
    token = create_access_token(
        user_id=user.id,
        username=user.username,
        role=user.role,
        permissions=permissions,
        # Giữ nguyên mốc đăng nhập gốc — đây là thứ làm trần có hiệu lực
        login_at=int(claims.get("lgn") or claims.get("iat") or now.timestamp()),
    )
    # KHÔNG ghi audit mỗi lần gia hạn: cứ ~24 phút một dòng cho mỗi tab đang mở
    # sẽ nhấn chìm những sự kiện thật sự đáng đọc trong `audit_log`.
    return {
        **session_out(user, token, permissions),
        "sessionExpiresAt": deadline.isoformat(),
    }


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
