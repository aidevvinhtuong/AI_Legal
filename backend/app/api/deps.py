"""
Dependency dùng chung của tầng API.

Nguyên tắc: `Principal` **luôn dựng lại từ DB**, không tin payload trong token.
Token chỉ nói "ai đang gọi"; quyền và trạng thái active đọc tươi mỗi request —
IT thu quyền của ai đó là có hiệu lực ngay, không phải đợi token hết hạn.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, UserRole
from app.domain.errors import ForbiddenError, StaleVersionError, UnauthorizedError
from app.domain.rbac import Principal
from app.infra.db import get_session
from app.infra.models import User
from app.services.identity.security import decode_access_token


def db_session() -> Iterator[Session]:
    yield from get_session()


DbSession = Annotated[Session, Depends(db_session)]


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise UnauthorizedError("Thiếu header Authorization")
    return authorization[7:].strip()


def access_claims(
    authorization: Annotated[str | None, Header()] = None,
) -> dict:
    """
    Claims thô của token đang dùng.

    Cần cho `/auth/refresh`: nó phải đọc `lgn` (thời điểm đăng nhập gốc) để biết
    phiên đã chạm trần tuyệt đối chưa. `Principal` cố tình không mang thông tin
    đó — nó dựng lại từ DB, mà DB thì không biết phiên này bắt đầu lúc nào.
    """
    return decode_access_token(_bearer(authorization))


AccessClaims = Annotated[dict, Depends(access_claims)]


def current_principal(
    db: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    payload = decode_access_token(_bearer(authorization))

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError) as e:
        raise UnauthorizedError() from e

    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise UnauthorizedError("Tài khoản không còn tồn tại")
    if not user.active:
        # Blueprint VI.5.3.1: Active=False thì không đăng nhập được — và cũng
        # không dùng tiếp được token đã cấp trước đó.
        raise ForbiddenError("Tài khoản đã bị vô hiệu hoá")

    try:
        role = UserRole(user.role)
    except ValueError as e:
        raise ForbiddenError(f"Vai trò “{user.role}” không được hỗ trợ") from e

    perms = frozenset(
        Permission(p) for p in (user.permissions or []) if p in Permission._value2member_map_
    )
    return Principal.build(
        user_id=user.id,
        username=user.username,
        role=role,
        permissions=perms or None,
        is_active=user.active,
    )


CurrentUser = Annotated[Principal, Depends(current_principal)]


def require(*permissions: Permission):
    """Dependency factory: `Depends(require(Permission.USERS))`."""

    def _dep(principal: CurrentUser) -> Principal:
        principal.require(*permissions)
        return principal

    return _dep


def if_match(request: Request) -> int | None:
    """
    Đọc `If-Match` → `row_version`. Không có header thì trả None (không kiểm).

    Cố ý KHÔNG bắt buộc ở M1: FE chưa gửi. Khi FE bổ sung, chỉ cần đổi endpoint
    nào cần thành bắt buộc mà không phải sửa tầng dưới.
    """
    raw = request.headers.get("if-match")
    if not raw:
        return None
    try:
        return int(raw.strip().strip('"').removeprefix("W/").strip('"'))
    except ValueError:
        return None


def assert_fresh(expected: int | None, actual: int) -> None:
    if expected is not None and expected != actual:
        raise StaleVersionError(expected=expected, actual=actual)


def fresh_row_version(db, entity) -> int:
    """
    Đọc lại `row_version` SAU khi ghi.

    `row_version` do trigger Postgres tăng trong lúc UPDATE, nên object trong
    session vẫn giữ giá trị cũ. Trả ETag từ giá trị cũ thì client dùng nó cho
    lần ghi kế tiếp và ăn 409 dù chẳng có ai sửa cùng — một xung đột giả.
    """
    db.flush()
    db.refresh(entity, ["row_version"])
    return int(entity.row_version)


def etag(row_version: int) -> str:
    return f'"{row_version}"'
