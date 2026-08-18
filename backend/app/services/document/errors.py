"""
Lỗi của tầng tài liệu.

Tách riêng khỏi `ooxml.DocxError` (lỗi định dạng gói) vì đây là lỗi **nghiệp vụ
ghi file**: tầng trên phải phân biệt được "file hỏng" với "yêu cầu ghi không hợp
lệ" để trả đúng mã HTTP và ghi đúng loại audit.

`LockViolationError` là lỗi nghiêm trọng nhất trong toàn hệ thống — nó là tín
hiệu ai đó (LLM bị lừa, FE bị bypass, request giả mạo) đang cố ghi vào vùng khoá.
"""

from __future__ import annotations


class DocumentWriteError(Exception):
    """Gốc của mọi lỗi khi ghi tài liệu."""


class LockViolationError(DocumentWriteError):
    """Cố ghi vào vùng không nằm trong allow-list. Vi phạm ràng buộc C-3."""

    def __init__(self, perm_id: str, reason: str = "not_in_allowlist") -> None:
        super().__init__(f"vùng {perm_id} không được phép ghi ({reason})")
        self.perm_id = perm_id
        self.reason = reason


class AnchorNotFoundError(DocumentWriteError):
    """Không tìm thấy `w:permStart` của vùng trong tài liệu."""

    def __init__(self, perm_id: str) -> None:
        super().__init__(f"không tìm thấy permStart của vùng {perm_id}")
        self.perm_id = perm_id


class EmptyRegionUnsupportedError(DocumentWriteError):
    """
    Vùng không có `w:r` nào bên trong.

    Không ghi được vì không có `w:rPr` để kế thừa — tự chế định dạng là cách
    chắc chắn nhất để lệch style so với phần còn lại của hợp đồng.
    """

    def __init__(self, perm_id: str) -> None:
        super().__init__(f"vùng {perm_id} rỗng, không có định dạng để kế thừa")
        self.perm_id = perm_id


class NotAtomicRegionError(DocumentWriteError):
    """Gọi writer inline cho vùng trải nhiều đoạn — sai chế độ ghi."""

    def __init__(self, perm_id: str, para_count: int) -> None:
        super().__init__(f"vùng {perm_id} trải {para_count} đoạn, phải dùng writer block")
        self.perm_id = perm_id
        self.para_count = para_count


class ParagraphCountMismatchError(DocumentWriteError):
    """
    Số đoạn đề xuất khác số đoạn của vùng.

    Phase 1 không cho thêm/bớt đoạn: nó kéo theo numbering, spacing và phân
    trang — vượt mức rủi ro chấp nhận được (TS-04 mục IV.2).
    """

    def __init__(self, perm_id: str, expected: int, got: int) -> None:
        super().__init__(f"vùng {perm_id} có {expected} đoạn, đề xuất đưa {got} đoạn")
        self.perm_id = perm_id
        self.expected = expected
        self.got = got


class EmptyParagraphNotWritableError(DocumentWriteError):
    """
    Đoạn không có run nào bên trong vùng mà lại được giao nội dung.

    Bỏ qua im lặng thì người dùng mất chữ mà không biết; nên chặn tường minh.
    """

    def __init__(self, perm_id: str, index: int) -> None:
        super().__init__(
            f"vùng {perm_id}: đoạn thứ {index} không có định dạng để kế thừa, chỉ nhận chuỗi rỗng"
        )
        self.perm_id = perm_id
        self.index = index


class PostcheckFailedError(DocumentWriteError):
    """Hậu kiểm phát hiện thay đổi nằm ngoài vùng cho phép. Phải rollback."""

    def __init__(self, diffs: list) -> None:  # list[XmlDiff] — tránh import vòng
        super().__init__(f"hậu kiểm phát hiện {len(diffs)} thay đổi ngoài vùng cho phép")
        self.diffs = diffs


class MarkerAnchorNotFoundError(DocumentWriteError):
    """
    Không tìm thấy đoạn neo của marker.

    Xảy ra khi tài liệu đã sang version mới mà FE còn giữ `paraId` cũ. Không
    được đoán bừa sang đoạn khác: chữ ký sẽ nằm sai chỗ trong hợp đồng thật.
    """

    def __init__(self, para_id: str) -> None:
        super().__init__(f"không tìm thấy đoạn có paraId={para_id} để neo marker")
        self.para_id = para_id


class MarkerPostcheckFailedError(DocumentWriteError):
    """
    Bản xuất bản để ký khác bản gốc ở chỗ KHÔNG PHẢI là marker vừa chèn.

    Đây là biến thể của C-3 cho đường eContract: chèn marker được phép thêm
    đúng những đoạn marker, không được đụng một byte nào khác.
    """

    def __init__(self, diffs: list) -> None:
        super().__init__(f"bản xuất bản có {len(diffs)} thay đổi ngoài các đoạn marker vừa chèn")
        self.diffs = diffs
