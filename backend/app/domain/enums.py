"""
Từ vựng của nghiệp vụ. Tên giá trị khớp `frontend/src/lib/types.ts` để FE không
phải ánh xạ — đổi một giá trị ở đây là đổi hợp đồng với FE.
"""

from __future__ import annotations

from enum import Enum


class UserRole(str, Enum):
    PURCHASING = "purchasing"
    PURCHASING_MANAGER = "purchasing_manager"
    LEGAL = "legal"
    IT = "it"
    # `legal_lead` đã bị bỏ từ Blueprint v1.8 và đã dọn khỏi FE ở vòng C.
    # Vẫn từ chối ở tầng validate phòng session cũ trong localStorage.


class Permission(str, Enum):
    """
    Quyền theo hạng mục — IT tick trên màn Users (Blueprint VI.5.3.1).

    Role chỉ quyết định bộ mặc định. Quyền thực tế luôn đọc từ `users.permissions`.
    """

    TASK = "task"
    CONTRACTS = "contracts"
    CONTRACTS_CREATE = "contracts_create"
    CONTRACT_CONFIG = "contract_config"
    FORM_LISTS = "form_lists"
    SYSTEM_PROMPTS = "system_prompts"
    USERS = "users"


DEFAULT_PERMISSIONS: dict[UserRole, frozenset[Permission]] = {
    UserRole.PURCHASING: frozenset(
        {Permission.TASK, Permission.CONTRACTS, Permission.CONTRACTS_CREATE}
    ),
    UserRole.PURCHASING_MANAGER: frozenset({Permission.TASK, Permission.CONTRACTS}),
    UserRole.LEGAL: frozenset({Permission.TASK, Permission.CONTRACTS, Permission.CONTRACT_CONFIG}),
    UserRole.IT: frozenset(Permission),
}


class ReviewStatus(str, Enum):
    """
    Vòng đời ticket (Blueprint Phụ lục B + bổ sung trạng thái lỗi).

    `AWAITING_MARKERS` là di sản: luồng cũ bắt gán marker TRƯỚC khi submit duyệt.
    Từ v1.24 marker làm SAU khi Legal duyệt, dùng `PENDING_MARKERS`. Giữ lại giá
    trị để đọc được dữ liệu cũ, nhưng không có transition nào dẫn vào nó.
    """

    DRAFT = "draft"
    QUEUED = "queued"
    PROCESSING = "processing"
    REVIEWED = "reviewed"
    AWAITING_MARKERS = "awaiting_markers"  # legacy — không dùng cho ticket mới
    PENDING_MANAGER = "pending_manager"
    PENDING_LEGAL = "pending_legal"
    PENDING_MARKERS = "pending_markers"
    REJECTED = "rejected"
    APPROVED = "approved"
    SYNCING_ECONTRACT = "syncing_econtract"
    SIGNED = "signed"
    # ── Bổ sung so với enum của FE: Blueprint không có trạng thái cho lỗi ──
    FAILED = "failed"  # pipeline AI hỏng
    ECONTRACT_FAILED = "econtract_failed"  # đẩy FPT hỏng, cho phép thử lại
    CANCELLED = "cancelled"  # huỷ ticket

    @property
    def is_terminal(self) -> bool:
        return self in (ReviewStatus.SIGNED, ReviewStatus.CANCELLED)

    @property
    def is_under_review(self) -> bool:
        """Đang nằm ở hàng chờ của người duyệt — chủ ticket không được sửa."""
        return self in (ReviewStatus.PENDING_MANAGER, ReviewStatus.PENDING_LEGAL)

    @property
    def blocks_document_write(self) -> bool:
        """
        Trạng thái cấm ghi tài liệu.

        Đang chạy AI mà user ghi thì hai bên đè lên nhau; đang chờ duyệt mà chủ
        ticket sửa thì người duyệt xem một đằng, thực tế một nẻo (câu hỏi mở
        A2 — giả định làm việc: KHÔNG cho sửa sau khi submit).
        """
        return self in (
            ReviewStatus.QUEUED,
            ReviewStatus.PROCESSING,
            ReviewStatus.PENDING_MANAGER,
            ReviewStatus.PENDING_LEGAL,
            ReviewStatus.SYNCING_ECONTRACT,
            ReviewStatus.SIGNED,
            ReviewStatus.CANCELLED,
        )


class ReviewKind(str, Enum):
    """
    Phân biệt hai lối vào — Blueprint §1.3.7.

    QUICK ("Review hợp đồng"): chỉ AI review, **dừng ở `reviewed`**. Không
    Submit duyệt, không eContract. Không có cờ này thì state machine không biết
    phải chặn ở đâu.
    """

    FULL = "full"
    QUICK = "quick"


class ReviewAction(str, Enum):
    """Hành động làm ticket đổi trạng thái. Chỉ backend được phép áp dụng."""

    CREATE = "create"
    SUBMIT_QUEUE = "submit_queue"
    START_PROCESSING = "start_processing"
    FINISH_AI = "finish_ai"
    FAIL_AI = "fail_ai"
    RETRY_AI = "retry_ai"
    REUPLOAD = "reupload"
    SUBMIT_APPROVAL = "submit_approval"
    MANAGER_APPROVE = "manager_approve"
    MANAGER_REJECT = "manager_reject"
    LEGAL_APPROVE = "legal_approve"
    LEGAL_REJECT = "legal_reject"
    RESUBMIT = "resubmit"
    PUSH_ECONTRACT = "push_econtract"
    ECONTRACT_DONE = "econtract_done"
    ECONTRACT_FAIL = "econtract_fail"
    CANCEL = "cancel"


class VersionAction(str, Enum):
    """Vì sao một version mới ra đời. Bộ đếm chung, không phân biệt actor."""

    CREATE = "create"
    AI_REVIEW = "ai_review"
    FIELD_EDIT = "field_edit"
    CHAT_EDIT = "chat_edit"
    SUBMIT = "submit"
    MANAGER_REJECT = "manager_reject"
    LEGAL_REJECT = "legal_reject"
    RESUBMIT = "resubmit"
    MARKER_INSERT = "marker_insert"
    REUPLOAD = "reupload"


class ProposalKind(str, Enum):
    """A = ghi được (vùng mở) · B = chỉ chú thích (vùng khoá)."""

    A = "A"
    B = "B"


class FindingGroup(str, Enum):
    """Bốn nhóm phát hiện hiển thị trên workspace."""

    RED_FLAG = "red_flag"
    WARNING = "warning"
    PROTECTION = "protection"
    MISSING_PROTECTION = "missing_protection"


class ConfigLayer(str, Enum):
    """
    Hai lớp cấu hình checklist (Blueprint §3).

    PARENT gắn Loại HĐ (`documentCategories.id`) — mọi Tên HĐ con hưởng chung.
    CHILD  gắn Tên HĐ (`contractNames.id`) — overlay opt-in, cùng mã điều khoản
           thì bản con thắng khi gộp.
    """

    PARENT = "parent"
    CHILD = "child"
