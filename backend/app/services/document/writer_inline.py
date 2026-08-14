"""
Chế độ A — ghi inline vào một `atomic_field`.

Ca phổ biến nhất (8/15 vùng của template HDDV) và an toàn nhất: vùng gọn trong
một đoạn, thường chỉ vài ký tự — số ngày, số tiền, tên địa điểm.

Đây cũng là chế độ bắt buộc cho **đoạn hỗn hợp**: câu do Legal khoá, chỉ vài giá
trị được mở, ví dụ

    "Bên Bán giao hàng trong vòng [30] ngày kể từ ngày [ký hợp đồng]."

Hai vùng mở nằm giữa các run khoá trong cùng một `w:p`. Ghi phải nhắm đúng run
của vùng, không được đụng phần còn lại của câu — nên writer làm việc ở cấp `w:r`,
không phải cấp `w:p`.
"""

from __future__ import annotations

from lxml.etree import _Element

from app.services.document.errors import EmptyRegionUnsupportedError, NotAtomicRegionError
from app.services.document.model import WriteReport
from app.services.document.region_locator import locate
from app.services.document.writer_common import rewrite_segment


def write_inline(body: _Element, perm_id: str, new_text: str) -> WriteReport:
    """
    Ghi `new_text` vào vùng `perm_id`.

    Điều kiện: vùng nằm gọn trong một đoạn và có ít nhất một run bên trong.
    Không tự động chuyển sang chế độ block khi vùng trải nhiều đoạn — sai chế độ
    ghi là lỗi của tầng gọi, phải lộ ra chứ không được đoán ý.
    """
    segments = locate(body, perm_id)

    if len(segments) != 1:
        raise NotAtomicRegionError(perm_id, len(segments))

    segment = segments[0]
    if not segment.runs:
        raise EmptyRegionUnsupportedError(perm_id)

    old_text = segment.text
    runs_removed, rpr_preserved = rewrite_segment(segment, new_text)

    return WriteReport(
        perm_id=perm_id,
        mode="inline",
        paragraphs_touched=1,
        runs_removed=runs_removed,
        rpr_preserved=rpr_preserved,
        old_text=old_text,
        new_text=new_text,
    )
