"""
Chế độ B — ghi theo đoạn vào một `block_region`.

Ca của vùng Thanh toán (13 đoạn, 2.092 ký tự) và khối thông tin các bên. Đây là
văn bản tự do thật sự, nơi AI redlining có ý nghĩa.

RÀNG BUỘC PHASE 1 — SỐ ĐOẠN KHÔNG ĐỔI.
Đề xuất phải có đúng số phần tử bằng số đoạn của vùng. Thêm hay bớt đoạn kéo
theo numbering, style, spacing và phân trang — vượt mức rủi ro chấp nhận được khi
mục tiêu là "output giống hệt input về format" (C-2). Đề xuất sai số đoạn bị từ
chối ở tầng allow-list, trước khi tới writer.

Đoạn không có run nào bên trong vùng (đoạn trống trong khối) **chỉ nhận chuỗi
rỗng**. Giao nội dung cho nó là lỗi: không có `w:rPr` để kế thừa, mà bỏ qua im
lặng thì người dùng mất chữ mà không biết.
"""

from __future__ import annotations

from lxml.etree import _Element

from app.services.document.errors import (
    EmptyParagraphNotWritableError,
    ParagraphCountMismatchError,
)
from app.services.document.model import WriteReport
from app.services.document.region_locator import locate
from app.services.document.writer_common import rewrite_segment


def write_block(body: _Element, perm_id: str, new_paragraphs: list[str]) -> WriteReport:
    """Ghi từng đoạn của vùng `perm_id`. Giữ nguyên khung đoạn và `w14:paraId`."""
    segments = locate(body, perm_id)

    if len(segments) != len(new_paragraphs):
        raise ParagraphCountMismatchError(perm_id, len(segments), len(new_paragraphs))

    old_parts: list[str] = []
    touched = 0
    runs_removed = 0
    rpr_preserved = True

    for index, (segment, text) in enumerate(zip(segments, new_paragraphs, strict=True)):
        old_parts.append(segment.text)

        if not segment.runs:
            if text:
                raise EmptyParagraphNotWritableError(perm_id, index)
            continue

        removed, has_rpr = rewrite_segment(segment, text)
        runs_removed += removed
        rpr_preserved = rpr_preserved and has_rpr
        touched += 1

    return WriteReport(
        perm_id=perm_id,
        mode="block",
        paragraphs_touched=touched,
        runs_removed=runs_removed,
        rpr_preserved=rpr_preserved,
        old_text="\n".join(old_parts),
        new_text="\n".join(new_paragraphs),
    )
