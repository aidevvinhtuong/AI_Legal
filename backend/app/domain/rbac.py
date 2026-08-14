"""
RBAC — quyền theo hạng mục và phạm vi dữ liệu.

Bất biến B4 của `backend/CLAUDE.md`:

    RBAC enforce ở tầng repository, KHÔNG phải ở router.
    Router quên kiểm thì vẫn phải an toàn.

Nên module này không trả `True/False` cho router tự xử lý, mà trả về một
`ReviewScope` — mệnh đề lọc mà repository **bắt buộc** đưa vào câu `WHERE`. Một
truy vấn danh sách viết đúng kiểu thì không thể lộ dữ liệu, kể cả khi quên kiểm
quyền ở tầng trên.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.domain.enums import DEFAULT_PERMISSIONS, Permission, ReviewStatus, UserRole
from app.domain.errors import ForbiddenError


@dataclass(frozen=True)
class Principal:
    """Người đang thao tác. Dựng từ token + bản ghi user, không tin body request."""

    user_id: UUID
    username: str
    role: UserRole
    permissions: frozenset[Permission]
    is_active: bool = True

    @classmethod
    def build(
        cls,
        *,
        user_id: UUID,
        username: str,
        role: UserRole,
        permissions: frozenset[Permission] | None = None,
        is_active: bool = True,
    ) -> Principal:
        """Không tick quyền nào thì dùng bộ mặc định của role (Blueprint VI.5.2)."""
        effective = permissions if permissions else DEFAULT_PERMISSIONS[role]
        return cls(
            user_id=user_id,
            username=username,
            role=role,
            permissions=frozenset(effective),
            is_active=is_active,
        )

    def has(self, permission: Permission) -> bool:
        return permission in self.permissions

    def require(self, *permissions: Permission) -> None:
        """Cần ÍT NHẤT MỘT trong các quyền liệt kê."""
        if not any(p in self.permissions for p in permissions):
            names = " hoặc ".join(p.value for p in permissions)
            raise ForbiddenError(f"Thao tác này cần quyền: {names}")


@dataclass(frozen=True)
class ReviewScope:
    """
    Phạm vi ticket mà một người được nhìn thấy (quyết định A5).

    - `all_reviews=True`   : Legal và IT — thấy tất cả.
    - `owner_id`           : Purchasing — chỉ ticket của chính mình.
    - `subordinate_of`     : Purchasing Manager — ticket của user có Line
                             Manager là mình. Repository join `users.line_manager_id`.

    Manager thấy được ticket của cấp dưới ở MỌI trạng thái (để theo dõi), nhưng
    chỉ *thao tác* được khi ticket ở `pending_manager` — đó là việc của
    `state_machine`, không phải của scope.
    """

    all_reviews: bool = False
    owner_id: UUID | None = None
    subordinate_of: UUID | None = None

    @property
    def is_unrestricted(self) -> bool:
        return self.all_reviews


def review_scope(principal: Principal) -> ReviewScope:
    """Mệnh đề lọc bắt buộc cho mọi truy vấn danh sách ticket."""
    principal.require(Permission.CONTRACTS, Permission.TASK)

    if principal.role in (UserRole.LEGAL, UserRole.IT):
        return ReviewScope(all_reviews=True)
    if principal.role is UserRole.PURCHASING_MANAGER:
        # Ticket của chính mình + ticket của cấp dưới
        return ReviewScope(owner_id=principal.user_id, subordinate_of=principal.user_id)
    return ReviewScope(owner_id=principal.user_id)


def can_view_review(
    principal: Principal,
    *,
    owner_id: UUID,
    owner_line_manager_id: UUID | None,
) -> bool:
    scope = review_scope(principal)
    if scope.all_reviews:
        return True
    if scope.owner_id is not None and owner_id == scope.owner_id:
        return True
    return scope.subordinate_of is not None and owner_line_manager_id == scope.subordinate_of


def assert_can_view_review(
    principal: Principal,
    *,
    owner_id: UUID,
    owner_line_manager_id: UUID | None,
) -> None:
    """
    Ném 403 thay vì 404 một cách CỐ Ý.

    Trả 404 sẽ để lộ "id này không tồn tại" ≠ "id này của người khác" — đủ để dò
    ra ticket của người khác có tồn tại hay không.
    """
    if not can_view_review(
        principal, owner_id=owner_id, owner_line_manager_id=owner_line_manager_id
    ):
        raise ForbiddenError("Bạn không có quyền xem hợp đồng này")


def can_edit_document(
    principal: Principal,
    *,
    owner_id: UUID,
    status: ReviewStatus,
) -> bool:
    """
    Chỉ chủ ticket được sửa nội dung, và chỉ khi trạng thái cho phép.

    Người duyệt KHÔNG sửa tài liệu: mọi yêu cầu chỉnh sửa của Manager/Legal đều
    phải kết thúc bằng Từ chối (A4b).
    """
    if status.blocks_document_write:
        return False
    if principal.role is UserRole.IT:
        return True
    return principal.user_id == owner_id


def assert_can_edit_document(
    principal: Principal,
    *,
    owner_id: UUID,
    status: ReviewStatus,
) -> None:
    from app.domain.errors import LockedError

    if status.blocks_document_write:
        raise LockedError(f"Không sửa được tài liệu khi ticket đang ở trạng thái “{status.value}”")
    if not can_edit_document(principal, owner_id=owner_id, status=status):
        raise ForbiddenError("Chỉ người tạo hợp đồng mới được sửa nội dung")
