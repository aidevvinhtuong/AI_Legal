"""
RBAC — quyền hạng mục và phạm vi dữ liệu (quyết định A5).

Điểm cần bảo vệ nhất: Purchasing không được thấy hợp đồng của người khác, và
điều đó phải đúng ngay cả khi router quên kiểm — nên test bám vào `review_scope`
(mệnh đề WHERE của repository), không bám vào router.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.domain.enums import Permission, ReviewStatus, UserRole
from app.domain.errors import ForbiddenError, LockedError
from app.domain.rbac import (
    Principal,
    assert_can_edit_document,
    assert_can_view_review,
    can_view_review,
    review_scope,
)

ALICE = uuid4()  # purchasing
BOSS = uuid4()  # line manager của Alice
BOB = uuid4()  # purchasing khác


def principal(role: UserRole, user_id=None, **kwargs) -> Principal:
    return Principal.build(
        user_id=user_id or uuid4(), username=role.value, role=role, **kwargs
    )


# ─────────────────────────────────────────────────────────────────────────────
# Quyền hạng mục
# ─────────────────────────────────────────────────────────────────────────────
def test_quyen_mac_dinh_theo_role():
    assert principal(UserRole.PURCHASING).has(Permission.CONTRACTS_CREATE)
    assert not principal(UserRole.PURCHASING).has(Permission.CONTRACT_CONFIG)
    assert principal(UserRole.LEGAL).has(Permission.CONTRACT_CONFIG)
    assert not principal(UserRole.LEGAL).has(Permission.USERS)
    assert principal(UserRole.IT).has(Permission.USERS)


def test_quyen_tick_tay_de_len_mac_dinh_cua_role():
    """Role chỉ là gợi ý — quyền thật là những gì IT tick (Blueprint VI.5.2)."""
    custom = principal(UserRole.PURCHASING, permissions=frozenset({Permission.USERS}))
    assert custom.has(Permission.USERS)
    assert not custom.has(Permission.CONTRACTS_CREATE)


def test_require_can_it_nhat_mot_quyen():
    p = principal(UserRole.PURCHASING_MANAGER)
    p.require(Permission.TASK, Permission.USERS)  # có TASK → qua
    with pytest.raises(ForbiddenError) as e:
        p.require(Permission.USERS, Permission.SYSTEM_PROMPTS)
    assert "users" in e.value.detail


# ─────────────────────────────────────────────────────────────────────────────
# Phạm vi ticket
# ─────────────────────────────────────────────────────────────────────────────
def test_purchasing_chi_thay_ticket_cua_chinh_minh():
    alice = principal(UserRole.PURCHASING, ALICE)
    scope = review_scope(alice)

    assert scope.owner_id == ALICE
    assert scope.all_reviews is False
    assert can_view_review(alice, owner_id=ALICE, owner_line_manager_id=BOSS)
    assert not can_view_review(alice, owner_id=BOB, owner_line_manager_id=None)


def test_manager_thay_ticket_cua_cap_duoi():
    boss = principal(UserRole.PURCHASING_MANAGER, BOSS)

    assert can_view_review(boss, owner_id=ALICE, owner_line_manager_id=BOSS)
    assert not can_view_review(boss, owner_id=BOB, owner_line_manager_id=None)


def test_legal_va_it_thay_tat_ca():
    for role in (UserRole.LEGAL, UserRole.IT):
        scope = review_scope(principal(role))
        assert scope.all_reviews is True


def test_xem_trom_ticket_nguoi_khac_tra_403_khong_phai_404():
    """404 sẽ để lộ ticket đó có tồn tại hay không — đủ để dò dữ liệu."""
    alice = principal(UserRole.PURCHASING, ALICE)
    with pytest.raises(ForbiddenError):
        assert_can_view_review(alice, owner_id=BOB, owner_line_manager_id=None)


# ─────────────────────────────────────────────────────────────────────────────
# Quyền sửa tài liệu
# ─────────────────────────────────────────────────────────────────────────────
def test_chi_chu_ticket_duoc_sua_tai_lieu():
    alice = principal(UserRole.PURCHASING, ALICE)
    assert_can_edit_document(alice, owner_id=ALICE, status=ReviewStatus.REVIEWED)

    with pytest.raises(ForbiddenError):
        assert_can_edit_document(alice, owner_id=BOB, status=ReviewStatus.REVIEWED)


def test_nguoi_duyet_khong_sua_tai_lieu():
    """A4b — mọi yêu cầu chỉnh sửa của Manager/Legal phải kết thúc bằng Từ chối."""
    legal = principal(UserRole.LEGAL)
    with pytest.raises((ForbiddenError, LockedError)):
        assert_can_edit_document(legal, owner_id=ALICE, status=ReviewStatus.PENDING_LEGAL)


@pytest.mark.parametrize(
    "status",
    [
        ReviewStatus.QUEUED,
        ReviewStatus.PROCESSING,
        ReviewStatus.PENDING_MANAGER,
        ReviewStatus.PENDING_LEGAL,
        ReviewStatus.SYNCING_ECONTRACT,
        ReviewStatus.SIGNED,
    ],
)
def test_trang_thai_khoa_ghi_thi_chu_ticket_cung_khong_sua_duoc(status):
    alice = principal(UserRole.PURCHASING, ALICE)
    with pytest.raises(LockedError):
        assert_can_edit_document(alice, owner_id=ALICE, status=status)


@pytest.mark.parametrize(
    "status", [ReviewStatus.DRAFT, ReviewStatus.REVIEWED, ReviewStatus.REJECTED]
)
def test_trang_thai_cho_ghi(status):
    alice = principal(UserRole.PURCHASING, ALICE)
    assert_can_edit_document(alice, owner_id=ALICE, status=status)
