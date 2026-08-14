"""
Mật khẩu và token.

Auth tối giản (username/password + JWT) là **bản tạm có chủ đích**: câu hỏi SSO
(GĐ-4/D2) chưa có lời đáp. Toàn bộ phần này nằm sau `authenticate()` và
`Principal`, nên đổi sang AD/LDAP/OAuth sau này chỉ phải viết một provider mới,
không đụng nghiệp vụ.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.domain.errors import UnauthorizedError
from app.infra.settings import get_settings

_hasher = PasswordHasher()


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    """Không phân biệt "sai mật khẩu" với "hash hỏng" — cả hai đều là không qua."""
    try:
        return _hasher.verify(hashed, raw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    try:
        return _hasher.check_needs_rehash(hashed)
    except InvalidHashError:
        return True


def create_access_token(
    *,
    user_id: uuid.UUID,
    username: str,
    role: str,
    permissions: list[str],
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        # Quyền nằm trong token cho tiện, NHƯNG mọi kiểm tra thật vẫn đọc lại từ
        # DB: IT thu quyền của ai đó thì phải có hiệu lực ngay, không đợi hết hạn.
        "perms": permissions,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)).timestamp()),
        "iss": "ai-legal",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            issuer="ai-legal",
        )
    except jwt.ExpiredSignatureError as e:
        raise UnauthorizedError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại") from e
    except jwt.PyJWTError as e:
        raise UnauthorizedError() from e
