"""
Cắt tài liệu thành đơn vị điều khoản (Điều / Khoản / Điểm) cho pipeline AI.

CÁI BẪY CHÍNH (PH-6): số điều khoản KHÔNG nằm trong text — Word sinh ra từ
`numbering.xml`. Một implementation ngây thơ dùng `re.match(r'^Điều\\s+\\d+')`
trên text sẽ khớp ĐÚNG 0 LẦN trên template thật. Vì vậy thứ tự ưu tiên là:

    1. numbering_label đã resolve  ← đáng tin nhất
    2. style Heading1..Heading4
    3. regex trên text             ← chỉ để đỡ cho tài liệu không đánh số
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.services.document.model import ParagraphDescriptor, normalize

# "Điều 5." → mức 1 · "5.2" → mức 2 · "5.2.3" → mức 3 · "(4)" → mức 4
_RE_DIEU = re.compile(r"^\s*Điều\s+([0-9IVXLC]+)\s*[.:]?\s*$", re.IGNORECASE)
_RE_DOTTED = re.compile(r"^\s*(\d+(?:\.\d+)*)\s*\.?\s*$")
_RE_PAREN = re.compile(r"^\s*\(([0-9a-zA-Z]+)\)\s*$")
_RE_HEADING_STYLE = re.compile(r"^Heading(\d)$", re.IGNORECASE)
# Chỉ dùng khi hai nguồn trên đều vắng
_RE_TEXT_FALLBACK = re.compile(r"^\s*(Điều\s+\d+|CHƯƠNG\s+[IVXLC]+)\b", re.IGNORECASE)


@dataclass
class Segment:
    """
    Một đơn vị điều khoản. Mang theo đủ thông tin để:
      - trích dẫn đúng vị trí cho Legal ("Điều 5.2")
      - biết mình nằm trong vùng mở hay vùng khoá (quyết định Loại A / Loại B)
      - neo evidence về đúng đoạn
    """

    ordinal: int
    level: int
    numbering_path: str | None
    heading: str
    body_text: str
    para_ids: tuple[str, ...]
    is_open: bool
    perm_ids: tuple[str, ...] = ()

    @property
    def full_text(self) -> str:
        head = f"{self.numbering_path or ''} {self.heading}".strip()
        return f"{head}\n{self.body_text}".strip() if head else self.body_text

    @property
    def char_len(self) -> int:
        return len(self.body_text)

    @property
    def citation(self) -> str:
        """Chuỗi hiển thị cho người dùng. 'Điều 5.2 — Thanh toán'."""
        if self.numbering_path and self.heading:
            return f"{self.numbering_path} — {self.heading}"
        return self.numbering_path or self.heading or f"Đoạn {self.ordinal}"


@dataclass
class _Open:
    level: int
    numbering_path: str | None
    heading: str
    # Thứ tự đoạn đầu tiên TRONG TÀI LIỆU. Bắt buộc phải có: paraId là chuỗi hex
    # ngẫu nhiên, sắp theo nó thì segment ra lộn xộn.
    first_ordinal: int = -1
    para_ids: list[str] = field(default_factory=list)
    body: list[str] = field(default_factory=list)
    perm_ids: set[str] = field(default_factory=set)
    any_open: bool = False
    all_open: bool = True


def detect_level(p: ParagraphDescriptor) -> tuple[int, str | None] | None:
    """
    Đoạn này có mở đầu một điều khoản mới không?
    Trả về (mức, số hiệu) hoặc None nếu là đoạn nội dung thường.
    """
    label = (p.numbering_label or "").strip()
    if label:
        if _RE_DIEU.match(label):
            return 1, label.rstrip(".:").strip()
        if m := _RE_DOTTED.match(label):
            return 1 + m.group(1).count("."), m.group(1)
        if _RE_PAREN.match(label):
            return 4, label
        return 2, label  # có đánh số nhưng dạng lạ — coi là mức khoản

    if p.style_name and (m := _RE_HEADING_STYLE.match(p.style_name)):
        return int(m.group(1)), None

    if _RE_TEXT_FALLBACK.match(p.text):
        return 1, None

    return None


def segment(paragraphs: list[ParagraphDescriptor]) -> list[Segment]:
    """
    Cắt danh sách đoạn (THEO ĐÚNG THỨ TỰ TÀI LIỆU) thành các segment.

    Đoạn nội dung gắn vào segment mở gần nhất. Đoạn trước segment đầu tiên
    (tiêu đề hợp đồng, thông tin các bên) gom thành một segment mức 0.
    """
    out: list[tuple[int, Segment]] = []
    stack: list[_Open] = []
    preamble = _Open(level=0, numbering_path=None, heading="Phần mở đầu")

    def flush(acc: _Open) -> None:
        if not acc.para_ids:
            return
        out.append(
            (
                acc.first_ordinal,
                Segment(
                    ordinal=0,  # đánh lại sau khi sắp theo thứ tự tài liệu
                    level=acc.level,
                    numbering_path=acc.numbering_path,
                    heading=acc.heading,
                    body_text=normalize("\n".join(acc.body)),
                    para_ids=tuple(acc.para_ids),
                    # Chỉ coi là vùng mở khi MỌI đoạn đều nằm trong vùng mở.
                    # Segment vắt ngang ranh giới ⇒ xử lý an toàn về phía khoá.
                    is_open=acc.any_open and acc.all_open,
                    perm_ids=tuple(sorted(acc.perm_ids)),
                ),
            )
        )

    for p in paragraphs:
        detected = detect_level(p)

        if detected is not None:
            level, number = detected
            # Đóng mọi segment có mức sâu hơn hoặc bằng
            while stack and stack[-1].level >= level:
                flush(stack.pop())
            if not stack and preamble.para_ids:
                flush(preamble)
                preamble = _Open(level=0, numbering_path=None, heading="")

            acc = _Open(
                level=level,
                numbering_path=_build_path(stack, number),
                heading=normalize(p.text),
            )
            _absorb(acc, p)
            stack.append(acc)
            continue

        target = stack[-1] if stack else preamble
        _absorb(target, p)

    while stack:
        flush(stack.pop())
    if preamble.para_ids and not out:
        flush(preamble)

    # Sắp theo THỨ TỰ TÀI LIỆU rồi mới đánh số ordinal
    out.sort(key=lambda pair: pair[0])
    segments = [s for _, s in out]
    for i, s in enumerate(segments):
        s.ordinal = i
    return segments


def _absorb(acc: _Open, p: ParagraphDescriptor) -> None:
    if acc.first_ordinal < 0:
        acc.first_ordinal = p.ordinal
    acc.para_ids.append(p.para_id)
    if p.text.strip():
        acc.body.append(p.text)
    acc.perm_ids.update(p.perm_ids)
    if p.is_open:
        acc.any_open = True
    else:
        acc.all_open = False


def _build_path(stack: list[_Open], number: str | None) -> str | None:
    """Số hiệu dạng '5.2' đã đầy đủ; dạng '(a)' cần ghép với cha."""
    if number is None:
        return None
    if number.startswith("Điều") or "." in number:
        return number
    parent = next((s.numbering_path for s in reversed(stack) if s.numbering_path), None)
    return f"{parent}{number}" if parent else number


def segments_for_field(segments: list[Segment], perm_id: str) -> list[Segment]:
    """Các segment chạm vào một vùng mở — dùng cho `field_validation` chạy hẹp."""
    return [s for s in segments if perm_id in s.perm_ids]
