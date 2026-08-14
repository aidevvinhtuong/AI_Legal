"""
Định vị một vùng mở trong cây XML — nền của cả hai writer và của hậu kiểm.

Vì sao cần một module riêng thay vì tìm trực tiếp bằng XPath: `w:permStart` và
`w:permEnd` **không bao bọc** nội dung như một thẻ mở/đóng thông thường. Chúng là
hai thẻ rỗng nằm rải trong luồng văn bản, và có thể ở hai cấp khác nhau:

    <w:p>… <w:permStart w:id="123"/> <w:r>30</w:r> <w:permEnd w:id="123"/> …</w:p>
    ─────────────── inline: cả hai nằm trong cùng một đoạn ───────────────

    <w:permStart w:id="456"/>
    <w:p>…</w:p>  <w:p>…</w:p>  <w:p>…</w:p>
    <w:permEnd w:id="456"/>
    ─────────── block: hai thẻ nằm ở cấp thân, bao lấy nhiều đoạn ──────────

Nên "nội dung của vùng" chỉ xác định được bằng cách **duyệt theo đúng thứ tự tài
liệu** và bật/tắt một cờ. Đó là việc của module này.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from lxml.etree import _Element

from app.services.document.errors import AnchorNotFoundError
from app.services.document.ooxml import qn, run_text


@dataclass
class RegionSegment:
    """Phần của một vùng mở nằm trong đúng MỘT đoạn."""

    paragraph: _Element
    runs: list[_Element] = field(default_factory=list)
    started_inside: bool = False  # permStart nằm trong đoạn này
    ended_inside: bool = False  # permEnd nằm trong đoạn này

    @property
    def text(self) -> str:
        return "".join(run_text(r) for r in self.runs)

    @property
    def writable(self) -> bool:
        """Có `w:rPr` để kế thừa hay không."""
        return bool(self.runs)


def locate(body: _Element, perm_id: str) -> list[RegionSegment]:
    """
    Trả về các đoạn mà vùng `perm_id` chạm tới, theo thứ tự tài liệu.

    Ném `AnchorNotFoundError` nếu không có `w:permStart` nào mang id đó — nghĩa là
    file đã bị thay thế hoặc id không còn hợp lệ. Không bao giờ trả về danh sách
    rỗng một cách im lặng.
    """
    segments: list[RegionSegment] = []
    state = _WalkState(perm_id=perm_id)
    _visit(body, state, segments)

    if not state.found_start:
        raise AnchorNotFoundError(perm_id)
    return segments


def locate_all(body: _Element, perm_ids: set[str]) -> dict[str, list[RegionSegment]]:
    """Định vị nhiều vùng trong một lượt duyệt — dùng cho hậu kiểm."""
    return {pid: locate(body, pid) for pid in sorted(perm_ids)}


@dataclass
class _WalkState:
    perm_id: str
    active: bool = False
    found_start: bool = False


def _visit(node: _Element, state: _WalkState, out: list[RegionSegment]) -> None:
    """Duyệt đệ quy theo thứ tự tài liệu, giữ cờ `active` xuyên suốt."""
    for child in node:
        tag = child.tag

        if tag == qn("w:p"):
            seg = _scan_paragraph(child, state)
            if seg is not None:
                out.append(seg)

        elif tag == qn("w:permStart"):
            if child.get(qn("w:id")) == state.perm_id:
                state.active = True
                state.found_start = True

        elif tag == qn("w:permEnd"):
            if child.get(qn("w:id")) == state.perm_id:
                state.active = False

        elif len(child):
            # w:tbl → w:tr → w:tc → w:p, và w:sdt → w:sdtContent
            _visit(child, state, out)


def _scan_paragraph(para: _Element, state: _WalkState) -> RegionSegment | None:
    """
    Quét một đoạn theo thứ tự văn bản.

    Dùng `iter()` để bắt cả run nằm trong `w:hyperlink`, `w:ins`, `w:smartTag`.
    Hệ quả đã biết và chấp nhận: run trong textbox (`w:txbxContent`) của đoạn này
    cũng bị tính là thuộc đoạn — giống hệt cách `paragraph_text` của tầng đọc
    hoạt động, nên hai tầng nhất quán với nhau.
    """
    entry_active = state.active
    local_active = entry_active
    started = ended = False
    runs: list[_Element] = []

    for sub in para.iter():
        tag = sub.tag
        if tag == qn("w:permStart"):
            if sub.get(qn("w:id")) == state.perm_id:
                local_active = True
                started = True
                state.found_start = True
        elif tag == qn("w:permEnd"):
            if sub.get(qn("w:id")) == state.perm_id:
                local_active = False
                ended = True
        elif tag == qn("w:r") and local_active:
            runs.append(sub)

    state.active = local_active

    if not (entry_active or started):
        return None
    return RegionSegment(paragraph=para, runs=runs, started_inside=started, ended_inside=ended)
