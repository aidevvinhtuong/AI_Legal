"""
Lỗi nghiệp vụ. Tầng API đổi sang RFC 9457 (`application/problem+json`).

Thân lỗi luôn có `detail` dạng chuỗi — `frontend/src/lib/api.ts` đọc lần lượt
`error` → `message` → `detail`, nên giữ `detail` là chuỗi thì FE hiển thị được
ngay mà không cần sửa gì.

`code` là mã ổn định để FE phân nhánh xử lý và để đếm metric. Đừng đổi mã đã
phát hành; thêm mã mới thì rẻ.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AppError(Exception):
    """Gốc của mọi lỗi có thể trả về cho client."""

    code: str = "internal_error"
    detail: str = "Đã có lỗi xảy ra"
    status: int = 500
    title: str = "Lỗi hệ thống"
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(self.detail)

    def to_problem(self, instance: str | None = None) -> dict[str, Any]:
        """Thân RFC 9457."""
        body: dict[str, Any] = {
            "type": f"https://ailegal.local/errors/{self.code}",
            "title": self.title,
            "status": self.status,
            "detail": self.detail,
            "code": self.code,
        }
        if instance:
            body["instance"] = instance
        body.update(self.extra)
        return body


class NotFoundError(AppError):
    def __init__(self, what: str = "Tài nguyên", code: str = "not_found") -> None:
        super().__init__(
            code=code,
            detail=f"{what} không tồn tại",
            status=404,
            title="Không tìm thấy",
        )


class ValidationError(AppError):
    def __init__(self, detail: str, *, code: str = "validation_error", **extra: Any) -> None:
        super().__init__(
            code=code, detail=detail, status=422, title="Dữ liệu không hợp lệ", extra=extra
        )


class UnauthorizedError(AppError):
    def __init__(self, detail: str = "Phiên đăng nhập không hợp lệ hoặc đã hết hạn") -> None:
        super().__init__(code="unauthorized", detail=detail, status=401, title="Chưa xác thực")


class ForbiddenError(AppError):
    """
    Dùng cho CẢ hai trường hợp: thiếu quyền, và không thuộc phạm vi dữ liệu.

    Cố ý không phân biệt "không có quyền" với "không tồn tại" ở tầng thông báo:
    Purchasing dò id của người khác không được phép biết ticket đó có tồn tại
    hay không (A5).
    """

    def __init__(self, detail: str = "Bạn không có quyền thực hiện thao tác này") -> None:
        super().__init__(code="forbidden", detail=detail, status=403, title="Không đủ quyền")


class ConflictError(AppError):
    def __init__(self, detail: str, *, code: str = "conflict", **extra: Any) -> None:
        super().__init__(code=code, detail=detail, status=409, title="Xung đột", extra=extra)


class StaleVersionError(ConflictError):
    """Client gửi `If-Match` cũ — ai đó đã sửa trước. Optimistic locking."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(
            "Bản ghi đã được người khác cập nhật. Tải lại rồi thao tác tiếp.",
            code="stale_version",
            expectedVersion=expected,
            currentVersion=actual,
        )


class LockedError(AppError):
    """423 — tài nguyên đang bị khoá theo trạng thái (job AI đang chạy, đang chờ duyệt)."""

    def __init__(self, detail: str) -> None:
        super().__init__(code="resource_locked", detail=detail, status=423, title="Đang khoá")


class InvalidTransitionError(AppError):
    """Hành động không hợp lệ với trạng thái/vai trò hiện tại."""

    def __init__(self, status_from: str, action: str, reason: str = "") -> None:
        detail = f"Không thể thực hiện “{action}” khi ticket đang ở trạng thái “{status_from}”"
        if reason:
            detail = f"{detail}: {reason}"
        super().__init__(
            code="invalid_transition",
            detail=detail,
            status=409,
            title="Chuyển trạng thái không hợp lệ",
            extra={"from": status_from, "action": action},
        )


class StructuralBindingError(AppError):
    """
    File tải lên không khớp cấu trúc template. **Không có override** (C-4).

    `issues` giữ đúng hình dạng `FieldStructureIssue[]` của FE để component hiển
    thị lỗi dùng lại được.
    """

    def __init__(self, issues: list[dict[str, Any]]) -> None:
        super().__init__(
            code="structural_binding_failed",
            detail="File tải lên không khớp cấu trúc template đã đăng ký",
            status=422,
            title="Sai cấu trúc template",
            extra={"issues": issues},
        )


class WriteRejectedError(AppError):
    """Một phần hoặc toàn bộ yêu cầu ghi bị allow-list Lớp 1 từ chối."""

    def __init__(self, rejections: list[dict[str, Any]]) -> None:
        super().__init__(
            code="write_rejected",
            detail="Yêu cầu ghi bị từ chối vì nằm ngoài vùng được phép sửa",
            status=422,
            title="Không được phép ghi",
            extra={"rejections": rejections},
        )


class UpstreamError(AppError):
    """Dịch vụ ngoài (LLM, MinIO, FPT) hỏng. 502 để phân biệt với lỗi của ta."""

    def __init__(self, service: str, detail: str = "") -> None:
        super().__init__(
            code="upstream_error",
            detail=detail or f"Dịch vụ {service} không phản hồi",
            status=502,
            title="Lỗi dịch vụ ngoài",
            extra={"service": service},
        )
