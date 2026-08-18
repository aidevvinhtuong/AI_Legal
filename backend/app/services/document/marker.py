"""
Chèn marker ký số của FPT.eContract vào `.docx`.

## Vì sao neo bằng `paraId` chứ không phải toạ độ trang

FE cho người dùng kéo-thả trên preview và gửi lên `(page, xPct, yPct)`. Toạ độ
trang **chỉ tồn tại sau khi phân trang** — OOXML không có khái niệm trang, nên
không có phép ánh xạ ngược nào đáng tin. FPT đã xác nhận nhận `.docx` (base64),
tức không có bước render PDF để lấy toạ độ. Vì vậy neo của marker là
`w14:paraId` của đoạn văn — thứ duy nhất vừa ổn định qua round-trip Word (đo
được 197/197 trên template thật) vừa định vị được khi ghi.

Người dùng vẫn kéo-thả; FE chỉ đổi thứ gửi lên: thay vì toạ độ thì gửi paraId
của đoạn gần nhất, chọn từ danh sách `list_anchors()` trả về.

## Vì sao đây là "bản xuất bản", không phải bản gốc

Chèn marker về mặt kỹ thuật là **ghi vào vùng khoá**. Quy tắc bù lại:

    File `.docx` of record KHÔNG BAO GIỜ bị sửa. Marker chỉ được chèn vào một
    bản sao sinh ra lúc Submit, lưu riêng dưới `ReviewFile(kind="econtract")`.

Và `assert_marker_only()` chứng minh điều đó: bản xuất bản khác bản gốc **đúng
ở những đoạn marker vừa chèn**, không hơn. Cùng tinh thần với `postcheck.py`
của đường ghi trường — không tuyên bố suông, mà đối chiếu bằng chứng cứ.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass

from lxml import etree
from lxml.etree import _Element

from app.services.document.errors import (
    MarkerAnchorNotFoundError,
    MarkerPostcheckFailedError,
)
from app.services.document.model import FieldInventory, XmlDiff
from app.services.document.ooxml import (
    DOCUMENT_PART,
    DocxPackage,
    paragraph_text,
    qn,
)
from app.services.document.postcheck import diff_outside
from app.services.document.writer_common import find_body

# Bề rộng ô ký = khoảng cách giữa hai dấu `#` khi render (tài liệu FPT). Ta chỉ
# điều khiển được nó bằng SỐ KHOẢNG TRẮNG, nên cần một hệ số quy đổi px → space.
# 8.0 là con số FE demo đang dùng; **phải hiệu chuẩn lại trên môi trường Demo
# của FPT** (ca kiểm thử EC-07) rồi chỉnh qua settings, không sửa hằng số ở đây.
DEFAULT_PX_PER_SPACE = 8.0

# Marker phải nằm ở cỡ chữ thật của tài liệu. Thu nhỏ xuống 1pt cho "đỡ chiếm
# chỗ" là hỏng: FPT đo bề rộng ô ký theo kích thước render, chữ nhỏ ⇒ ô ký nhỏ.
WHITE = "FFFFFF"

ALIGNMENTS = ("left", "center", "right")
POSITIONS = ("after", "before")

# `#ds:ds_p_001_r_001 r:p_001_r_001 h:98      #`
MARKER_RE = re.compile(r"^#(ds|is|st):(\S+)\s+r:(\S+)\s+h:(\d+)(\s+)#$")


@dataclass(frozen=True)
class MarkerAnchor:
    """Một vị trí neo hợp lệ để đặt marker. FE hiển thị danh sách này làm điểm hít."""

    para_id: str
    ordinal: int
    preview: str
    in_table: bool
    is_open: bool
    blank: bool = False
    numbering_label: str | None = None
    recommended: bool = False


@dataclass(frozen=True)
class MarkerPlacement:
    """Một marker cần chèn. Toàn bộ dữ liệu đã được validate ở tầng trên."""

    marker_id: str  # duy nhất toàn file (ràng buộc C-8)
    marker_type: str  # ds | is | st
    recipient_ref: str  # p_001_r_001
    height: int
    para_id: str
    width_px: int = 164
    align: str = "left"
    position: str = "after"

    def __post_init__(self) -> None:
        if self.marker_type not in ("ds", "is", "st"):
            raise ValueError(f"loại marker không hợp lệ: {self.marker_type!r}")
        if self.align not in ALIGNMENTS:
            raise ValueError(f"căn lề không hợp lệ: {self.align!r}")
        if self.position not in POSITIONS:
            raise ValueError(f"vị trí chèn không hợp lệ: {self.position!r}")
        if self.height <= 0:
            raise ValueError("chiều cao ô ký phải > 0")


@dataclass(frozen=True)
class MarkerInsertResult:
    document: bytes
    texts: tuple[str, ...]  # chuỗi marker đã chèn, theo đúng thứ tự placements


# ─────────────────────────────────────────────────────────────────────────────
# Danh sách neo
# ─────────────────────────────────────────────────────────────────────────────
# Dòng kẻ để ký: đoạn chỉ gồm gạch dưới / gạch ngang / dấu chấm. Đây là quy ước
# TRÌNH BÀY, không phải nội dung pháp lý — nên dò nó không vi phạm B3, khác hẳn
# với việc dò từ khoá kiểu "ĐẠI DIỆN BÊN MUA".
SIGNATURE_RULE_RE = re.compile(r"^[_.\-–—\s]{10,}$")

# Chữ ký nằm PHÍA TRÊN dòng kẻ, tên và chức vụ nằm dưới. Nên vùng gợi ý là mấy
# đoạn trống ngay trước dòng kẻ.
ANCHOR_LOOKBACK = 5


def list_anchors(inventory: FieldInventory, *, tail_ratio: float = 0.1) -> list[MarkerAnchor]:
    """
    Mọi đoạn đều neo được; `recommended` là gợi ý điểm hít cho UI.

    Cách tìm khối chữ ký **thuần cấu trúc**: định vị các đoạn chỉ chứa dòng kẻ
    (`____________`) rồi lấy vùng ngay trên chúng. Đo trên hai hợp đồng thật thì
    ra đúng 2 khối chữ ký mỗi file, không nhiễu. Không có dòng kẻ nào (một số
    template không dùng) thì lùi về phần đuôi tài liệu.

    Đoạn TRỐNG cũng là anchor hợp lệ — thực tế đó lại là chỗ đẹp nhất để đặt ô
    ký, nên không được lọc bỏ.
    """
    paragraphs = inventory.paragraphs
    if not paragraphs:
        return []

    recommended = _recommended_ordinals(paragraphs, tail_ratio=tail_ratio)

    return [
        MarkerAnchor(
            para_id=p.para_id,
            ordinal=p.ordinal,
            preview=_preview(p.text),
            in_table=p.in_table,
            is_open=p.is_open,
            blank=not p.text.strip(),
            numbering_label=p.numbering_label,
            recommended=p.ordinal in recommended,
        )
        for p in paragraphs
    ]


def _recommended_ordinals(paragraphs: list, *, tail_ratio: float) -> set[int]:
    rules = [p for p in paragraphs if SIGNATURE_RULE_RE.match(p.text.strip())]
    if rules:
        out: set[int] = set()
        for rule in rules:
            for p in paragraphs:
                if (
                    rule.ordinal - ANCHOR_LOOKBACK <= p.ordinal <= rule.ordinal
                    and p.in_table == rule.in_table
                ):
                    out.add(p.ordinal)
        return out

    last = max(p.ordinal for p in paragraphs)
    return {p.ordinal for p in paragraphs if p.ordinal >= last * (1 - tail_ratio)}


def _preview(text: str, limit: int = 120) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


# ─────────────────────────────────────────────────────────────────────────────
# Cú pháp marker
# ─────────────────────────────────────────────────────────────────────────────
def marker_text(placement: MarkerPlacement, *, px_per_space: float = DEFAULT_PX_PER_SPACE) -> str:
    """
    `#ds:<id> r:<recipientId> h:<cao><khoảng trắng>#` — đúng tài liệu FPT.

    Số khoảng trắng quy đổi từ bề rộng mong muốn; tối thiểu 1 để chuỗi vẫn đúng
    cú pháp khi người dùng đặt ô ký rất hẹp.
    """
    spaces = max(1, round(placement.width_px / px_per_space))
    return (
        f"#{placement.marker_type}:{placement.marker_id} "
        f"r:{placement.recipient_ref} h:{placement.height}{' ' * spaces}#"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Chèn
# ─────────────────────────────────────────────────────────────────────────────
def insert_markers(
    blob: bytes,
    placements: list[MarkerPlacement],
    *,
    px_per_space: float = DEFAULT_PX_PER_SPACE,
) -> MarkerInsertResult:
    """
    Sinh bản xuất bản có marker. **Không sửa `blob`**, trả ra bytes mới.

    All-or-nothing: hậu kiểm hỏng thì ném, không trả tài liệu dở dang.
    """
    if not placements:
        return MarkerInsertResult(document=blob, texts=())

    pkg = DocxPackage.load(blob)
    body = find_body(pkg.tree(DOCUMENT_PART))
    by_para_id = _index_paragraphs(body)

    texts: list[str] = []
    for placement in placements:
        anchor = by_para_id.get(placement.para_id)
        if anchor is None:
            raise MarkerAnchorNotFoundError(placement.para_id)
        text = marker_text(placement, px_per_space=px_per_space)
        _insert_one(anchor, placement, text)
        texts.append(text)

    pkg.mark_dirty(DOCUMENT_PART)
    after = pkg.to_bytes()

    assert_marker_only(before=blob, after=after, marker_texts=texts)
    return MarkerInsertResult(document=after, texts=tuple(texts))


def _index_paragraphs(body: _Element) -> dict[str, _Element]:
    """
    `paraId` → phần tử `w:p`, theo thứ tự tài liệu.

    Khoá dự phòng `__idx{n}` khớp đúng cách `ooxml_reader` đặt tên khi đoạn
    không có `w14:paraId` — nhờ vậy anchor do reader sinh ra luôn tra được.
    """
    out: dict[str, _Element] = {}
    for idx, para in enumerate(body.iter(qn("w:p"))):
        value = para.get(qn("w14:paraId"))
        key = value if value and value != "00000000" else f"__idx{idx}"
        out.setdefault(key, para)
    return out


def _insert_one(anchor: _Element, placement: MarkerPlacement, text: str) -> None:
    parent = anchor.getparent()
    if parent is None:  # w:p luôn có cha (w:body / w:tc / w:sdtContent)
        raise MarkerAnchorNotFoundError(placement.para_id)

    para = _build_marker_paragraph(anchor, placement, text)
    index = parent.index(anchor)

    # Đoạn chứa `w:sectPr` định nghĩa section — chèn sau nó là đẩy marker sang
    # section kế tiếp (thường là trang mới). Luôn chèn TRƯỚC trong ca này.
    before = placement.position == "before" or _has_sect_pr(anchor)
    parent.insert(index if before else index + 1, para)


def _has_sect_pr(para: _Element) -> bool:
    ppr = para.find(qn("w:pPr"))
    return ppr is not None and ppr.find(qn("w:sectPr")) is not None


def _build_marker_paragraph(anchor: _Element, placement: MarkerPlacement, text: str) -> _Element:
    para = etree.Element(qn("w:p"))

    # `w:pPr` dựng MỚI, không copy từ đoạn neo. Copy sẽ kéo theo `w:numPr` và
    # `w:pStyle` — marker liền được Word đánh số như một khoản mới, làm lệch số
    # thứ tự của toàn bộ điều khoản phía sau (bẫy F5).
    ppr = etree.SubElement(para, qn("w:pPr"))
    spacing = etree.SubElement(ppr, qn("w:spacing"))
    spacing.set(qn("w:before"), "0")
    spacing.set(qn("w:after"), "0")
    jc = etree.SubElement(ppr, qn("w:jc"))
    jc.set(qn("w:val"), placement.align)

    # Thụt lề thì copy được — nó chỉ định vị, không mang ngữ nghĩa đánh số.
    anchor_ppr = anchor.find(qn("w:pPr"))
    if anchor_ppr is not None:
        ind = anchor_ppr.find(qn("w:ind"))
        if ind is not None:
            ppr.append(copy.deepcopy(ind))

    run = etree.SubElement(para, qn("w:r"))
    run.append(_marker_rpr(anchor))

    node = etree.SubElement(run, qn("w:t"))
    node.set(qn("xml:space"), "preserve")  # cú pháp marker CÓ khoảng trắng
    node.text = text
    return para


def _marker_rpr(anchor: _Element) -> _Element:
    """
    `w:rPr` của marker: kế thừa run đầu tiên của đoạn neo rồi ép màu trắng.

    Kế thừa để marker có cùng font và cỡ chữ với văn bản xung quanh — FPT đo bề
    rộng ô ký theo kích thước render, nên cỡ chữ phải đúng thì ô ký mới đúng.
    """
    source = _nearest_rpr(anchor)
    rpr = copy.deepcopy(source) if source is not None else etree.Element(qn("w:rPr"))

    for tag in ("w:color", "w:highlight"):
        for node in rpr.findall(qn(tag)):
            rpr.remove(node)

    color = etree.SubElement(rpr, qn("w:color"))
    color.set(qn("w:val"), WHITE)  # mực trắng — ràng buộc C-8
    return rpr


def _nearest_rpr(anchor: _Element) -> _Element | None:
    """
    `w:rPr` gần nhất để kế thừa.

    Đoạn neo đẹp nhất lại thường là đoạn TRỐNG (khoảng trắng phía trên dòng kẻ
    ký) — không có run nào để lấy định dạng. Khi đó lùi lên các đoạn liền kề
    trong cùng ô/cùng khối; cùng lắm mới chịu dùng style mặc định.
    """
    run = anchor.find(qn("w:r"))
    if run is not None and (rpr := run.find(qn("w:rPr"))) is not None:
        return rpr

    parent = anchor.getparent()
    if parent is None:
        return None
    siblings = [el for el in parent if el.tag == qn("w:p")]
    index = siblings.index(anchor)
    for neighbour in [*reversed(siblings[:index]), *siblings[index + 1 :]]:
        for candidate in neighbour.iterfind(qn("w:r")):
            found = candidate.find(qn("w:rPr"))
            if found is not None:
                return found
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Hậu kiểm
# ─────────────────────────────────────────────────────────────────────────────
def assert_marker_only(*, before: bytes, after: bytes, marker_texts: list[str]) -> None:
    """
    Bản xuất bản chỉ được khác bản gốc ở đúng các đoạn marker vừa chèn.

    Cách chứng minh: gỡ các đoạn marker khỏi bản sau rồi so với bản trước bằng
    chính `diff_outside()` của đường ghi trường — với allow-list RỖNG, tức
    không có một vùng nào được phép khác.
    """
    diffs = diff_marker_only(before=before, after=after, marker_texts=marker_texts)
    if diffs:
        raise MarkerPostcheckFailedError(diffs)


def diff_marker_only(*, before: bytes, after: bytes, marker_texts: list[str]) -> list[XmlDiff]:
    pkg = DocxPackage.load(after)
    root = pkg.tree(DOCUMENT_PART)
    body = find_body(root)

    expected = list(marker_texts)
    for para in list(body.iter(qn("w:p"))):
        text = paragraph_text(para)
        if text in expected:
            expected.remove(text)
            parent = para.getparent()
            if parent is not None:
                parent.remove(para)

    if expected:
        return [
            XmlDiff(
                part=DOCUMENT_PART,
                location="marker",
                detail=f"không tìm lại được marker vừa chèn: {expected[0]!r}",
            )
        ]

    pkg.mark_dirty(DOCUMENT_PART)
    return diff_outside(before, pkg.to_bytes(), allowed_perm_ids=set())


__all__ = [
    "DEFAULT_PX_PER_SPACE",
    "MARKER_RE",
    "MarkerAnchor",
    "MarkerInsertResult",
    "MarkerPlacement",
    "assert_marker_only",
    "diff_marker_only",
    "insert_markers",
    "list_anchors",
    "marker_text",
]
