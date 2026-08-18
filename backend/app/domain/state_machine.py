"""
Máy trạng thái của ticket — bảng (trạng thái × hành động × vai trò) → trạng thái.

**Backend là nơi duy nhất được phép chuyển trạng thái.** FE có thể ẩn nút cho
đẹp, nhưng mọi ràng buộc đều kiểm lại ở đây; không có đường tắt nào khác.

Bảng bám Blueprint Phụ lục B (v1.27) với ba khác biệt được ghi rõ:

  1. Ticket QUICK ("Review hợp đồng", §1.3.7) **dừng ở `reviewed`** — mọi hành
     động sau đó bị chặn bằng guard, không phải bằng quy ước.
  2. Bổ sung trạng thái lỗi mà Blueprint không có: `failed` (AI hỏng) và
     `econtract_failed` (đẩy FPT hỏng) — thiếu chúng thì ticket lỗi mắc kẹt
     vĩnh viễn ở `processing` / `syncing_econtract`.
  3. `awaiting_markers` và `approved` là di sản của luồng cũ: không transition
     nào dẫn vào, giữ giá trị chỉ để đọc dữ liệu cũ.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.domain.enums import ReviewAction, ReviewKind, ReviewStatus, UserRole
from app.domain.errors import ForbiddenError, InvalidTransitionError

SYSTEM: frozenset[UserRole] = frozenset()  # rỗng = chỉ hệ thống, không phải người


@dataclass(frozen=True)
class TransitionContext:
    """
    Toàn bộ dữ kiện mà máy trạng thái cần. Không truy vấn DB, không đọc HTTP —
    tầng service nạp sẵn rồi truyền vào, nhờ vậy test được bằng bảng thuần.
    """

    status: ReviewStatus
    kind: ReviewKind = ReviewKind.FULL
    role: UserRole | None = None  # None = hệ thống (worker, callback)
    is_owner: bool = False
    is_line_manager_of_owner: bool = False
    owner_has_line_manager: bool = False
    has_unsaved_changes: bool = False
    ai_job_running: bool = False
    markers_valid: bool = False
    signing_matrix_ready: bool = False
    comment_provided: bool = False


Guard = Callable[[TransitionContext], str | None]


def _no_guard(_: TransitionContext) -> str | None:
    return None


def _is_full_kind(ctx: TransitionContext) -> str | None:
    if ctx.kind is ReviewKind.QUICK:
        return (
            "ticket tạo từ màn «Review hợp đồng» chỉ dùng để AI review, không đi tiếp luồng duyệt"
        )
    return None


def _ready_to_submit(ctx: TransitionContext) -> str | None:
    """A4c: lưu thủ công, phải lưu xong mới được submit."""
    if (reason := _is_full_kind(ctx)) is not None:
        return reason
    if ctx.has_unsaved_changes:
        return "còn thay đổi chưa lưu"
    if ctx.ai_job_running:
        return "đang có job AI chạy"
    return None


def _requires_comment(ctx: TransitionContext) -> str | None:
    """Từ chối mà không nói lý do thì Purchasing không biết sửa gì."""
    if not ctx.comment_provided:
        return "phải nhập lý do từ chối"
    return None


def _signing_matrix_ready(ctx: TransitionContext) -> str | None:
    """
    Legal duyệt là lúc hệ thống resolve người ký bên mua từ bảng Phân quyền ký.
    Không có dòng nào khớp thì chặn — nếu không ticket sẽ kẹt ở `pending_markers`
    mà người tạo không tự gỡ được.
    """
    if not ctx.signing_matrix_ready:
        return (
            "chưa có dòng Phân quyền ký khớp Công ty / Loại HĐ / Giá trị hợp đồng — "
            "đề nghị IT bổ sung tại Configurations → Phân quyền ký"
        )
    return None


def _markers_valid(ctx: TransitionContext) -> str | None:
    if not ctx.markers_valid:
        return "chưa gán đủ marker cho Người ký chính và Văn thư"
    return None


@dataclass(frozen=True)
class Transition:
    action: ReviewAction
    sources: frozenset[ReviewStatus]
    target: ReviewStatus
    actors: frozenset[UserRole]
    owner_only: bool = False
    manager_of_owner: bool = False
    guard: Guard = _no_guard
    note: str = ""


_OWNERS = frozenset({UserRole.PURCHASING, UserRole.IT})

TRANSITIONS: tuple[Transition, ...] = (
    # ── Tạo và hàng đợi ───────────────────────────────────────────────────
    Transition(
        action=ReviewAction.SUBMIT_QUEUE,
        sources=frozenset({ReviewStatus.DRAFT}),
        target=ReviewStatus.QUEUED,
        actors=_OWNERS,
        owner_only=True,
        note="Nháp → vào Processing Queue",
    ),
    Transition(
        action=ReviewAction.START_PROCESSING,
        sources=frozenset({ReviewStatus.QUEUED}),
        target=ReviewStatus.PROCESSING,
        actors=SYSTEM,
        note="Worker lấy job theo FIFO (C-7)",
    ),
    Transition(
        action=ReviewAction.FINISH_AI,
        sources=frozenset({ReviewStatus.PROCESSING}),
        target=ReviewStatus.REVIEWED,
        actors=SYSTEM,
    ),
    Transition(
        action=ReviewAction.FAIL_AI,
        sources=frozenset({ReviewStatus.QUEUED, ReviewStatus.PROCESSING}),
        target=ReviewStatus.FAILED,
        actors=SYSTEM,
    ),
    Transition(
        action=ReviewAction.RETRY_AI,
        sources=frozenset({ReviewStatus.FAILED, ReviewStatus.REVIEWED}),
        target=ReviewStatus.QUEUED,
        actors=_OWNERS,
        owner_only=True,
        note="Chạy lại AI review",
    ),
    # ── Trình duyệt ───────────────────────────────────────────────────────
    Transition(
        action=ReviewAction.SUBMIT_APPROVAL,
        sources=frozenset({ReviewStatus.REVIEWED}),
        target=ReviewStatus.PENDING_MANAGER,
        actors=_OWNERS,
        owner_only=True,
        guard=lambda ctx: (
            _ready_to_submit(ctx)
            or (None if ctx.owner_has_line_manager else "owner không có Line Manager")
        ),
        note="Có Line Manager → hàng chờ Manager",
    ),
    Transition(
        action=ReviewAction.SUBMIT_APPROVAL,
        sources=frozenset({ReviewStatus.REVIEWED}),
        target=ReviewStatus.PENDING_LEGAL,
        actors=_OWNERS,
        owner_only=True,
        guard=lambda ctx: (
            _ready_to_submit(ctx)
            or ("owner có Line Manager" if ctx.owner_has_line_manager else None)
        ),
        note="Không có Line Manager → thẳng hàng chờ Legal",
    ),
    Transition(
        action=ReviewAction.RESUBMIT,
        sources=frozenset({ReviewStatus.REJECTED}),
        target=ReviewStatus.PENDING_MANAGER,
        actors=_OWNERS,
        owner_only=True,
        guard=lambda ctx: (
            _ready_to_submit(ctx)
            or (None if ctx.owner_has_line_manager else "owner không có Line Manager")
        ),
        note="Sửa xong gửi lại — version bump",
    ),
    Transition(
        action=ReviewAction.RESUBMIT,
        sources=frozenset({ReviewStatus.REJECTED}),
        target=ReviewStatus.PENDING_LEGAL,
        actors=_OWNERS,
        owner_only=True,
        guard=lambda ctx: (
            _ready_to_submit(ctx)
            or ("owner có Line Manager" if ctx.owner_has_line_manager else None)
        ),
    ),
    # ── Manager ───────────────────────────────────────────────────────────
    Transition(
        action=ReviewAction.MANAGER_APPROVE,
        sources=frozenset({ReviewStatus.PENDING_MANAGER}),
        target=ReviewStatus.PENDING_LEGAL,
        actors=frozenset({UserRole.PURCHASING_MANAGER, UserRole.IT}),
        manager_of_owner=True,
        note="Approve KHÔNG kèm yêu cầu chỉnh (A4b)",
    ),
    Transition(
        action=ReviewAction.MANAGER_REJECT,
        sources=frozenset({ReviewStatus.PENDING_MANAGER}),
        target=ReviewStatus.REJECTED,
        actors=frozenset({UserRole.PURCHASING_MANAGER, UserRole.IT}),
        manager_of_owner=True,
        guard=_requires_comment,
    ),
    # ── Legal ─────────────────────────────────────────────────────────────
    Transition(
        action=ReviewAction.LEGAL_APPROVE,
        sources=frozenset({ReviewStatus.PENDING_LEGAL}),
        target=ReviewStatus.PENDING_MARKERS,
        actors=frozenset({UserRole.LEGAL, UserRole.IT}),
        guard=_signing_matrix_ready,
        note="KHÔNG gọi FPT ở bước này — chỉ resolve ma trận ký (v1.24)",
    ),
    Transition(
        action=ReviewAction.LEGAL_REJECT,
        sources=frozenset({ReviewStatus.PENDING_LEGAL}),
        target=ReviewStatus.REJECTED,
        actors=frozenset({UserRole.LEGAL, UserRole.IT}),
        guard=_requires_comment,
    ),
    # ── eContract ─────────────────────────────────────────────────────────
    Transition(
        action=ReviewAction.PUSH_ECONTRACT,
        sources=frozenset({ReviewStatus.PENDING_MARKERS, ReviewStatus.ECONTRACT_FAILED}),
        target=ReviewStatus.SYNCING_ECONTRACT,
        actors=_OWNERS,
        owner_only=True,
        guard=_markers_valid,
        note="Người tạo bấm Submit trên /design-markers",
    ),
    Transition(
        action=ReviewAction.ECONTRACT_DONE,
        sources=frozenset({ReviewStatus.SYNCING_ECONTRACT}),
        target=ReviewStatus.SIGNED,
        actors=SYSTEM,
    ),
    Transition(
        action=ReviewAction.ECONTRACT_FAIL,
        sources=frozenset({ReviewStatus.SYNCING_ECONTRACT}),
        target=ReviewStatus.ECONTRACT_FAILED,
        actors=SYSTEM,
        note="Cho thử lại, không kẹt vĩnh viễn",
    ),
    # ── Huỷ ───────────────────────────────────────────────────────────────
    Transition(
        action=ReviewAction.CANCEL,
        sources=frozenset(
            {
                ReviewStatus.DRAFT,
                ReviewStatus.QUEUED,
                ReviewStatus.REVIEWED,
                ReviewStatus.FAILED,
                ReviewStatus.REJECTED,
            }
        ),
        target=ReviewStatus.CANCELLED,
        actors=frozenset({UserRole.PURCHASING, UserRole.IT}),
        owner_only=True,
    ),
)


def next_status(ctx: TransitionContext, action: ReviewAction) -> ReviewStatus:
    """
    Trạng thái sau khi thực hiện `action`.

    Ném `ForbiddenError` nếu sai vai trò/phạm vi, `InvalidTransitionError` nếu
    sai trạng thái hoặc không qua guard. Phân biệt hai loại lỗi này quan trọng:
    403 là vấn đề của người dùng, 409 là vấn đề của quy trình.
    """
    by_action = [t for t in TRANSITIONS if t.action is action]
    if not by_action:
        raise InvalidTransitionError(ctx.status.value, action.value, "hành động không tồn tại")

    from_state = [t for t in by_action if ctx.status in t.sources]
    if not from_state:
        raise InvalidTransitionError(ctx.status.value, action.value)

    allowed_by_actor = [t for t in from_state if _actor_ok(ctx, t)]
    if not allowed_by_actor:
        raise ForbiddenError(f"Vai trò hiện tại không được phép thực hiện “{action.value}”")

    reasons: list[str] = []
    for transition in allowed_by_actor:
        reason = transition.guard(ctx)
        if reason is None:
            return transition.target
        reasons.append(reason)

    raise InvalidTransitionError(ctx.status.value, action.value, "; ".join(dict.fromkeys(reasons)))


def allowed_actions(ctx: TransitionContext) -> list[ReviewAction]:
    """Hành động thực hiện được ngay lúc này — API trả kèm để FE bật/tắt nút."""
    out: list[ReviewAction] = []
    for transition in TRANSITIONS:
        if transition.action in out:
            continue
        if ctx.status not in transition.sources:
            continue
        if not _actor_ok(ctx, transition):
            continue
        if transition.guard(ctx) is None:
            out.append(transition.action)
    return out


def _actor_ok(ctx: TransitionContext, transition: Transition) -> bool:
    if not transition.actors:  # SYSTEM
        return ctx.role is None
    if ctx.role is None or ctx.role not in transition.actors:
        return False
    # IT là vai trò vận hành, được thao tác thay để gỡ kẹt — vẫn ghi audit đầy đủ
    if ctx.role is UserRole.IT:
        return True
    if transition.owner_only and not ctx.is_owner:
        return False
    return not (transition.manager_of_owner and not ctx.is_line_manager_of_owner)
