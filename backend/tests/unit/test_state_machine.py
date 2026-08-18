"""
Bảng chuyển trạng thái — bám Blueprint Phụ lục B (v1.27).

Test này là bản đặc tả chạy được: đọc nó là biết ai được làm gì, lúc nào.
"""

from __future__ import annotations

import pytest

from app.domain.enums import ReviewAction, ReviewKind, ReviewStatus, UserRole
from app.domain.errors import ForbiddenError, InvalidTransitionError
from app.domain.state_machine import TransitionContext, allowed_actions, next_status

S = ReviewStatus
A = ReviewAction
R = UserRole


def ctx(status: S, **kwargs) -> TransitionContext:
    return TransitionContext(status=status, **kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Luồng chuẩn end-to-end
# ─────────────────────────────────────────────────────────────────────────────
def test_luong_chuan_co_line_manager():
    owner = {"role": R.PURCHASING, "is_owner": True, "owner_has_line_manager": True}

    assert next_status(ctx(S.DRAFT, **owner), A.SUBMIT_QUEUE) is S.QUEUED
    assert next_status(ctx(S.QUEUED), A.START_PROCESSING) is S.PROCESSING
    assert next_status(ctx(S.PROCESSING), A.FINISH_AI) is S.REVIEWED
    assert next_status(ctx(S.REVIEWED, **owner), A.SUBMIT_APPROVAL) is S.PENDING_MANAGER

    manager = {"role": R.PURCHASING_MANAGER, "is_line_manager_of_owner": True}
    assert next_status(ctx(S.PENDING_MANAGER, **manager), A.MANAGER_APPROVE) is S.PENDING_LEGAL

    legal = {"role": R.LEGAL, "signing_matrix_ready": True}
    assert next_status(ctx(S.PENDING_LEGAL, **legal), A.LEGAL_APPROVE) is S.PENDING_MARKERS

    assert (
        next_status(ctx(S.PENDING_MARKERS, **owner, markers_valid=True), A.PUSH_ECONTRACT)
        is S.SYNCING_ECONTRACT
    )
    assert next_status(ctx(S.SYNCING_ECONTRACT), A.ECONTRACT_DONE) is S.SIGNED


def test_khong_co_line_manager_thi_di_thang_len_legal():
    owner = {"role": R.PURCHASING, "is_owner": True, "owner_has_line_manager": False}
    assert next_status(ctx(S.REVIEWED, **owner), A.SUBMIT_APPROVAL) is S.PENDING_LEGAL


# ─────────────────────────────────────────────────────────────────────────────
# Ticket «Review hợp đồng» dừng ở reviewed (§1.3.7)
# ─────────────────────────────────────────────────────────────────────────────
def test_ticket_quick_khong_submit_duyet_duoc():
    quick = ctx(
        S.REVIEWED,
        kind=ReviewKind.QUICK,
        role=R.PURCHASING,
        is_owner=True,
        owner_has_line_manager=True,
    )

    with pytest.raises(InvalidTransitionError) as e:
        next_status(quick, A.SUBMIT_APPROVAL)

    assert "Review hợp đồng" in e.value.detail
    assert A.SUBMIT_APPROVAL not in allowed_actions(quick)


def test_ticket_quick_van_chay_lai_ai_duoc():
    quick = ctx(S.REVIEWED, kind=ReviewKind.QUICK, role=R.PURCHASING, is_owner=True)
    assert next_status(quick, A.RETRY_AI) is S.QUEUED


# ─────────────────────────────────────────────────────────────────────────────
# Vai trò và phạm vi
# ─────────────────────────────────────────────────────────────────────────────
def test_purchasing_khong_tu_duyet_duoc():
    with pytest.raises(ForbiddenError):
        next_status(ctx(S.PENDING_MANAGER, role=R.PURCHASING, is_owner=True), A.MANAGER_APPROVE)


def test_manager_khong_phai_line_manager_thi_khong_duyet_duoc():
    not_mine = ctx(S.PENDING_MANAGER, role=R.PURCHASING_MANAGER, is_line_manager_of_owner=False)
    with pytest.raises(ForbiddenError):
        next_status(not_mine, A.MANAGER_APPROVE)


def test_manager_khong_duoc_duyet_thay_legal():
    with pytest.raises(ForbiddenError):
        next_status(
            ctx(S.PENDING_LEGAL, role=R.PURCHASING_MANAGER, signing_matrix_ready=True),
            A.LEGAL_APPROVE,
        )


def test_nguoi_khong_phai_chu_ticket_khong_submit_duoc():
    with pytest.raises(ForbiddenError):
        next_status(
            ctx(S.REVIEWED, role=R.PURCHASING, is_owner=False, owner_has_line_manager=False),
            A.SUBMIT_APPROVAL,
        )


def test_hanh_dong_cua_he_thong_khong_ai_goi_thay_duoc():
    """`START_PROCESSING` là của worker. Người dùng gọi phải bị chặn."""
    with pytest.raises(ForbiddenError):
        next_status(ctx(S.QUEUED, role=R.IT), A.START_PROCESSING)


# ─────────────────────────────────────────────────────────────────────────────
# Guard
# ─────────────────────────────────────────────────────────────────────────────
def test_con_thay_doi_chua_luu_thi_khong_submit_duoc():
    """A4c — lưu thủ công, phải lưu xong mới submit."""
    dirty = ctx(
        S.REVIEWED,
        role=R.PURCHASING,
        is_owner=True,
        owner_has_line_manager=True,
        has_unsaved_changes=True,
    )
    with pytest.raises(InvalidTransitionError) as e:
        next_status(dirty, A.SUBMIT_APPROVAL)
    assert "chưa lưu" in e.value.detail


def test_dang_chay_ai_thi_khong_submit_duoc():
    busy = ctx(
        S.REVIEWED,
        role=R.PURCHASING,
        is_owner=True,
        owner_has_line_manager=True,
        ai_job_running=True,
    )
    with pytest.raises(InvalidTransitionError):
        next_status(busy, A.SUBMIT_APPROVAL)


def test_tu_choi_bat_buoc_co_ly_do():
    for role, action, status in (
        (R.PURCHASING_MANAGER, A.MANAGER_REJECT, S.PENDING_MANAGER),
        (R.LEGAL, A.LEGAL_REJECT, S.PENDING_LEGAL),
    ):
        no_comment = ctx(status, role=role, is_line_manager_of_owner=True, comment_provided=False)
        with pytest.raises(InvalidTransitionError) as e:
            next_status(no_comment, action)
        assert "lý do từ chối" in e.value.detail

        with_comment = ctx(status, role=role, is_line_manager_of_owner=True, comment_provided=True)
        assert next_status(with_comment, action) is S.REJECTED


def test_legal_duyet_bi_chan_khi_thieu_dong_ma_tran_ky():
    """Chặn ở đây thay vì để ticket kẹt ở pending_markers không ai gỡ được."""
    not_ready = ctx(S.PENDING_LEGAL, role=R.LEGAL, signing_matrix_ready=False)
    with pytest.raises(InvalidTransitionError) as e:
        next_status(not_ready, A.LEGAL_APPROVE)
    assert "Phân quyền ký" in e.value.detail


def test_day_econtract_bi_chan_khi_thieu_marker():
    owner = {"role": R.PURCHASING, "is_owner": True}
    with pytest.raises(InvalidTransitionError) as e:
        next_status(ctx(S.PENDING_MARKERS, **owner, markers_valid=False), A.PUSH_ECONTRACT)
    assert "marker" in e.value.detail


# ─────────────────────────────────────────────────────────────────────────────
# Trạng thái lỗi — bổ sung so với Blueprint
# ─────────────────────────────────────────────────────────────────────────────
def test_ai_hong_thi_chay_lai_duoc():
    assert next_status(ctx(S.PROCESSING), A.FAIL_AI) is S.FAILED
    assert next_status(ctx(S.FAILED, role=R.PURCHASING, is_owner=True), A.RETRY_AI) is S.QUEUED


def test_day_econtract_hong_thi_thu_lai_duoc_khong_ket_vinh_vien():
    assert next_status(ctx(S.SYNCING_ECONTRACT), A.ECONTRACT_FAIL) is S.ECONTRACT_FAILED
    retry = ctx(S.ECONTRACT_FAILED, role=R.PURCHASING, is_owner=True, markers_valid=True)
    assert next_status(retry, A.PUSH_ECONTRACT) is S.SYNCING_ECONTRACT


# ─────────────────────────────────────────────────────────────────────────────
# Trạng thái cuối và di sản
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("action", list(A))
def test_ticket_da_ky_thi_dong_bang(action):
    signed = ctx(S.SIGNED, role=R.IT, is_owner=True, markers_valid=True, comment_provided=True)
    with pytest.raises((InvalidTransitionError, ForbiddenError)):
        next_status(signed, action)


def test_khong_transition_nao_dan_vao_trang_thai_di_san():
    """`awaiting_markers` và `approved` chỉ để đọc dữ liệu cũ."""
    from app.domain.state_machine import TRANSITIONS

    targets = {t.target for t in TRANSITIONS}
    assert S.AWAITING_MARKERS not in targets
    assert S.APPROVED not in targets


def test_allowed_actions_dung_de_fe_bat_tat_nut():
    owner = ctx(S.REVIEWED, role=R.PURCHASING, is_owner=True, owner_has_line_manager=True)
    actions = allowed_actions(owner)

    assert A.SUBMIT_APPROVAL in actions
    assert A.RETRY_AI in actions
    assert A.MANAGER_APPROVE not in actions


def test_moi_trang_thai_khong_cuoi_deu_co_loi_ra():
    """Không được có trạng thái nào là ngõ cụt ngoài `signed` và `cancelled`."""
    from app.domain.state_machine import TRANSITIONS

    sources = {s for t in TRANSITIONS for s in t.sources}
    for status in S:
        if status.is_terminal or status in (S.AWAITING_MARKERS, S.APPROVED):
            continue
        assert status in sources, f"trạng thái {status.value} không có đường ra"
