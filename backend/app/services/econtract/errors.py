"""
Bảng mã lỗi FPT.eContract → thông báo tiếng Việt.

Toàn bộ lỗi validate marker của FPT đều trả `code: 13` kèm một `message` bằng
tiếng Anh dạng camelCase. Hiển thị thẳng chuỗi đó cho Purchasing là vô dụng —
họ không biết `wrongFieldWithRole` nghĩa là gì và phải sửa ở đâu.

Bảng này dùng cho HAI chiều:
  - dịch lỗi FPT trả về (khi request đã lọt qua validate của ta),
  - và làm từ vựng cho `validation.py` — validate phía ta dùng ĐÚNG mã lỗi đó,
    nên khi FE hiện lỗi thì người dùng thấy cùng một cách diễn đạt dù lỗi bị
    chặn ở tầng nào.
"""

from __future__ import annotations

FPT_ERROR_MESSAGES: dict[str, str] = {
    "isNotExistsMarkerField": (
        "Thiếu marker vị trí ký trong tài liệu — mỗi Người ký và Văn thư phải được đặt một ô ký"
    ),
    "tooManyMarkerDigitalField": (
        "Một người ký chỉ được có đúng một marker chữ ký số trong toàn tài liệu"
    ),
    "wrongFieldWithRole": ("Loại marker không khớp vai trò hoặc hình thức ký của người nhận"),
    "isNotExistsRecipientInfo": "Thiếu thông tin liên hệ của người nhận (email)",
    "recipientRoleIsNull": "Người nhận chưa có vai trò trong luồng ký",
    "isNotExistsIndividual": "Thiếu tên tổ chức / cá nhân của bên ký",
    "docTypeCodeIsNotExists": (
        "Mã loại tài liệu (docTypeCode) chưa được cấu hình trên cổng FPT.eContract"
    ),
    "requestNotContainsRefId": "Yêu cầu thiếu mã tham chiếu (refId)",
}

# Trạng thái hợp đồng bên FPT → trạng thái ticket bên mình.
# `Draft` cố tình KHÔNG ánh xạ: nó nghĩa là FPT nhận rồi nhưng chưa phát hành,
# ticket vẫn phải nằm ở `syncing_econtract` cho tới khi thật sự Processing.
ENVELOPE_STATUS_LABELS: dict[str, str] = {
    "Draft": "Đã tạo, chưa phát hành",
    "Processing": "Đang trình ký",
    "Completed": "Đã ký xong",
    "Rejected": "Có người ký từ chối",
    "Voided": "Đã huỷ",
    "Overdue": "Quá hạn ký",
}


def translate(code: str | None, fallback: str = "") -> str:
    """Thông báo tiếng Việt cho một mã lỗi FPT; không có trong bảng thì giữ nguyên."""
    if not code:
        return fallback or "Lỗi không xác định từ FPT.eContract"
    return FPT_ERROR_MESSAGES.get(code, fallback or code)


def describe_envelope_status(status: str | None) -> str:
    if not status:
        return ""
    return ENVELOPE_STATUS_LABELS.get(status, status)


class EcontractError(Exception):
    """
    Lỗi khi làm việc với FPT.eContract.

    `retryable` quyết định outbox có thử lại hay không: lỗi mạng / 5xx thì có,
    lỗi validate dữ liệu thì không — thử lại bao nhiêu lần cũng vẫn sai.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        retryable: bool = False,
        detail: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.retryable = retryable
        self.detail = detail or {}


__all__ = [
    "ENVELOPE_STATUS_LABELS",
    "FPT_ERROR_MESSAGES",
    "EcontractError",
    "describe_envelope_status",
    "translate",
]
