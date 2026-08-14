"""
Thao tác ghi cấp thấp dùng chung cho cả hai chế độ writer.

Toàn bộ độ an toàn của việc "giữ format" nằm ở đúng một hàm dưới đây. Quy tắc:

  1. **Kế thừa `w:rPr` của run đầu tiên trong vùng** (giữ nguyên object, không
     dựng lại). Font, cỡ chữ, đậm/nghiêng, màu, ngôn ngữ — tất cả nằm trong đó.
  2. **Chỉ giữ lại một run**, xoá các run còn lại *trong vùng*. Vùng mở thường
     bị Word cắt thành nhiều run vì lịch sử soạn thảo, không phải vì ngữ nghĩa.
  3. **Không đụng bất cứ thứ gì ngoài các run trong vùng**: `w:pPr`, `w:numPr`,
     `w:sectPr`, bookmark, `w:permStart`/`w:permEnd`, và đặc biệt là **attribute
     của `w:p`** — `w14:paraId` phải sống sót, nếu không mọi comment mồ côi.
  4. `xml:space="preserve"` luôn luôn có: thiếu nó là mất khoảng trắng đầu/cuối,
     và cú pháp marker eContract có khoảng trắng trong đó.
"""

from __future__ import annotations

from lxml import etree
from lxml.etree import _Element

from app.services.document.ooxml import qn
from app.services.document.region_locator import RegionSegment


def rewrite_segment(segment: RegionSegment, new_text: str) -> tuple[int, bool]:
    """
    Thay toàn bộ text của một segment bằng `new_text`.

    Trả về `(số run đã xoá, có kế thừa được w:rPr hay không)`.
    Gọi hàm này khi `segment.runs` rỗng là lỗi lập trình — kiểm tra trước.
    """
    runs = segment.runs
    if not runs:
        raise ValueError("rewrite_segment gọi trên segment không có run")

    keeper = runs[0]
    rpr = keeper.find(qn("w:rPr"))

    # Dọn nội dung của run giữ lại, chừa đúng w:rPr
    for child in list(keeper):
        if child.tag != qn("w:rPr"):
            keeper.remove(child)

    t = etree.SubElement(keeper, qn("w:t"))
    t.set(qn("xml:space"), "preserve")
    t.text = new_text

    for extra in runs[1:]:
        parent = extra.getparent()
        if parent is not None:
            parent.remove(extra)

    return len(runs) - 1, rpr is not None


def find_body(root: _Element) -> _Element:
    """`w:body` của `word/document.xml`."""
    body = root.find(qn("w:body"))
    if body is None:
        from app.services.document.ooxml import DocxError

        raise DocxError("Thiếu w:body")
    return body
