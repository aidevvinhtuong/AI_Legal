"""
Lớp nền OOXML: namespace, đọc/ghi gói .docx an toàn.

Nguyên tắc xuyên suốt module document/:

    CHỈ SERIALIZE LẠI PHẦN NÀO THỰC SỰ BỊ SỬA.

Mọi part khác giữ nguyên byte gốc, copy thẳng sang gói mới. Đây là điều kiện để
đạt tiêu chí "giữ format" (C-2 / NFR-R4): ta không thể vô tình làm hỏng
`styles.xml`, `numbering.xml`, header/footer nếu không bao giờ ghi lại chúng.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field

from lxml import etree
from lxml.etree import _Element

# ─────────────────────────────────────────────────────────────────────────────
# Namespace
# ─────────────────────────────────────────────────────────────────────────────
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "xml": "http://www.w3.org/XML/1998/namespace",
}


def qn(tag: str) -> str:
    """'w:permStart' → '{http://…}permStart'. Không bao giờ viết chuỗi namespace thẳng."""
    prefix, _, local = tag.partition(":")
    if not local:
        raise ValueError(f"thiếu prefix namespace: {tag!r}")
    try:
        return f"{{{NS[prefix]}}}{local}"
    except KeyError:
        raise ValueError(f"namespace chưa khai báo: {prefix!r}") from None


# Part hay dùng
DOCUMENT_PART = "word/document.xml"
SETTINGS_PART = "word/settings.xml"
NUMBERING_PART = "word/numbering.xml"
STYLES_PART = "word/styles.xml"
COMMENTS_PART = "word/comments.xml"
COMMENTS_EXT_PART = "word/commentsExtended.xml"
COMMENTS_IDS_PART = "word/commentsIds.xml"
PEOPLE_PART = "word/people.xml"


class DocxError(Exception):
    """Lỗi khi đọc/ghi gói .docx."""


class UnsafeDocxError(DocxError):
    """Gói .docx vượt ngưỡng an toàn — nghi ngờ zip bomb."""


# ─────────────────────────────────────────────────────────────────────────────
# Parser an toàn
# ─────────────────────────────────────────────────────────────────────────────
def _make_parser() -> etree.XMLParser:
    """
    Chống XXE và SSRF qua entity ngoài (TS-08 mục VII).
    `resolve_entities=False` + `no_network=True` là bắt buộc vì ta parse file
    do người dùng tải lên.
    """
    return etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        huge_tree=False,
        remove_blank_text=False,  # GIỮ nguyên whitespace — nó là nội dung tài liệu
        remove_comments=False,
        remove_pis=False,
    )


def parse_xml(data: bytes) -> _Element:
    try:
        return etree.fromstring(data, parser=_make_parser())
    except etree.XMLSyntaxError as e:
        raise DocxError(f"XML hỏng: {e}") from e


def serialize_xml(root: _Element) -> bytes:
    """
    Ghi lại một part. `standalone=True` và không thêm khoảng trắng —
    khớp cách Word xuất file, giảm nhiễu khi so sánh.
    """
    return etree.tostring(
        root.getroottree(),
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Gói .docx
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class DocxPackage:
    """
    Gói .docx đã nạp vào bộ nhớ.

    Giữ nguyên bytes gốc của MỌI part. Chỉ part nào được `mark_dirty` mới bị
    serialize lại khi `to_bytes()`. Không sửa gì ⇒ trả lại đúng bytes ban đầu,
    nên round-trip giống byte tuyệt đối (test FX-00).
    """

    original: bytes
    parts: dict[str, bytes]
    order: list[str]
    _trees: dict[str, _Element] = field(default_factory=dict, repr=False)
    _dirty: set[str] = field(default_factory=set, repr=False)

    # ── Nạp ───────────────────────────────────────────────────────────────
    @classmethod
    def load(
        cls,
        data: bytes,
        *,
        max_unzip_bytes: int = 100 * 1024 * 1024,
        max_entries: int = 500,
    ) -> DocxPackage:
        if not data.startswith(b"PK\x03\x04"):
            raise DocxError("Không phải file .docx (thiếu chữ ký ZIP)")

        parts: dict[str, bytes] = {}
        order: list[str] = []
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                infos = z.infolist()
                if len(infos) > max_entries:
                    raise UnsafeDocxError(f"Gói có {len(infos)} entry, vượt ngưỡng {max_entries}")
                total = sum(i.file_size for i in infos)
                if total > max_unzip_bytes:
                    raise UnsafeDocxError(
                        f"Giải nén ra {total:,} byte, vượt ngưỡng {max_unzip_bytes:,}"
                    )
                for info in infos:
                    if info.is_dir():
                        continue
                    order.append(info.filename)
                    parts[info.filename] = z.read(info.filename)
        except zipfile.BadZipFile as e:
            raise DocxError(f"ZIP hỏng: {e}") from e

        if DOCUMENT_PART not in parts:
            raise DocxError(f"Thiếu {DOCUMENT_PART} — không phải tài liệu Word hợp lệ")

        return cls(original=data, parts=parts, order=order)

    # ── Truy cập ──────────────────────────────────────────────────────────
    def has(self, part: str) -> bool:
        return part in self.parts

    def raw(self, part: str) -> bytes:
        try:
            return self.parts[part]
        except KeyError:
            raise DocxError(f"Không có part {part}") from None

    def tree(self, part: str) -> _Element:
        """Cây XML đã parse, cache lại. Sửa cây thì phải gọi `mark_dirty`."""
        if part not in self._trees:
            self._trees[part] = parse_xml(self.raw(part))
        return self._trees[part]

    def tree_or_none(self, part: str) -> _Element | None:
        return self.tree(part) if self.has(part) else None

    # ── Sửa ───────────────────────────────────────────────────────────────
    def mark_dirty(self, part: str) -> None:
        if part not in self._trees:
            raise DocxError(f"mark_dirty({part}) khi chưa parse part đó")
        self._dirty.add(part)

    def set_raw(self, part: str, data: bytes) -> None:
        """Thay nguyên một part bằng bytes mới (dùng cho part sinh mới, ví dụ comments.xml)."""
        if part not in self.parts:
            self.order.append(part)
        self.parts[part] = data
        self._trees.pop(part, None)
        self._dirty.discard(part)

    @property
    def dirty_parts(self) -> frozenset[str]:
        return frozenset(self._dirty)

    # ── Xuất ──────────────────────────────────────────────────────────────
    def to_bytes(self) -> bytes:
        """
        Không có part nào bẩn ⇒ trả lại BYTES GỐC, không dựng lại ZIP.

        Đây không phải tối ưu vặt: nó là lý do FX-00 (parse → export không sửa gì
        phải giống byte) đúng một cách tự nhiên, thay vì phải đấu với chênh lệch
        timestamp và mức nén của zipfile.
        """
        if not self._dirty:
            return self.original

        for part in self._dirty:
            self.parts[part] = serialize_xml(self._trees[part])

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            # [Content_Types].xml phải là entry đầu tiên theo đặc tả OPC
            names = list(self.order)
            if "[Content_Types].xml" in names:
                names.remove("[Content_Types].xml")
                names.insert(0, "[Content_Types].xml")
            for name in names:
                z.writestr(name, self.parts[name])

        self._dirty.clear()
        self._trees.clear()
        out = buf.getvalue()
        self.original = out
        return out


# ─────────────────────────────────────────────────────────────────────────────
# Tiện ích văn bản
# ─────────────────────────────────────────────────────────────────────────────
def run_text(run: _Element) -> str:
    """
    Text của một `w:r`. Bao gồm cả `w:tab` và `w:br` để offset ký tự khớp với
    những gì người đọc thấy.
    """
    out: list[str] = []
    for node in run.iter():
        tag = node.tag
        if tag == qn("w:t"):
            out.append(node.text or "")
        elif tag == qn("w:tab"):
            out.append("\t")
        elif tag in (qn("w:br"), qn("w:cr")):
            out.append("\n")
    return "".join(out)


def paragraph_text(para: _Element) -> str:
    """Text thô của một `w:p`, KHÔNG chuẩn hoá khoảng trắng."""
    return "".join(run_text(r) for r in para.iterfind(f".//{qn('w:r')}"))
