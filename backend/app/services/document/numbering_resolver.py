"""
Dựng lại số điều khoản mà Word sinh ra lúc render.

VÌ SAO CẦN: template thật khai báo trong `numbering.xml`
    lvl0 = "Điều %1."   lvl1 = "%1.%2"   lvl2 = "%3."   lvl3 = "(%4)"
Text thuần của đoạn tiêu đề chỉ có "Thanh toán" — con số "Điều 5." KHÔNG nằm
trong text. Bỏ qua bước này thì:
  1. checklist của Legal ghi "điều khoản tại Điều 5" sẽ không khớp được,
  2. finding trích dẫn "đoạn thứ 75" thay vì "Điều 5.2" — Legal không định vị được.

Module mô phỏng bộ đếm của Word, không render lại toàn bộ tài liệu.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass

from lxml.etree import _Element

from app.services.document.ooxml import NUMBERING_PART, STYLES_PART, DocxPackage, qn

# Số La Mã, dùng cho numFmt upperRoman/lowerRoman
_ROMAN = [
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
]


def _roman(n: int) -> str:
    if n <= 0:
        return str(n)
    out: list[str] = []
    for value, sym in _ROMAN:
        while n >= value:
            out.append(sym)
            n -= value
    return "".join(out)


def _letter(n: int) -> str:
    """1→a, 2→b, … 27→aa (kiểu bảng tính)."""
    if n <= 0:
        return str(n)
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("a") + rem) + out
    return out


def format_counter(value: int, num_fmt: str) -> str:
    if num_fmt == "upperRoman":
        return _roman(value).upper()
    if num_fmt == "lowerRoman":
        return _roman(value)
    if num_fmt == "upperLetter":
        return _letter(value).upper()
    if num_fmt == "lowerLetter":
        return _letter(value)
    if num_fmt in ("none", "bullet"):
        return ""
    return str(value)  # decimal và mọi thứ khác


@dataclass(frozen=True)
class LevelDef:
    ilvl: int
    start: int
    num_fmt: str
    lvl_text: str
    is_legal: bool = False  # w:isLgl — ép mọi mức về decimal khi hiển thị


@dataclass(frozen=True)
class NumPr:
    num_id: str
    ilvl: int


class NumberingResolver:
    """
    Nạp `numbering.xml` + `styles.xml` một lần, rồi resolve nhãn cho từng đoạn
    theo đúng thứ tự tài liệu.

        resolver = NumberingResolver(pkg)
        labels = resolver.resolve(paragraphs_in_document_order)
        # {'4C26EBD5': 'Điều 5.', '0C3238C0': '5.2', ...}
    """

    def __init__(self, pkg: DocxPackage) -> None:
        self._levels: dict[tuple[str, int], LevelDef] = {}
        self._style_numpr: dict[str, NumPr] = {}
        self._style_parent: dict[str, str] = {}
        self._load_numbering(pkg)
        self._load_styles(pkg)

    # ── Nạp định nghĩa ────────────────────────────────────────────────────
    def _load_numbering(self, pkg: DocxPackage) -> None:
        root = pkg.tree_or_none(NUMBERING_PART)
        if root is None:
            return

        # abstractNumId → {ilvl: LevelDef}
        abstract: dict[str, dict[int, LevelDef]] = {}
        for anum in root.iterfind(qn("w:abstractNum")):
            aid = anum.get(qn("w:abstractNumId"))
            if aid is None:
                continue
            levels: dict[int, LevelDef] = {}
            for lvl in anum.iterfind(qn("w:lvl")):
                d = self._parse_level(lvl)
                if d is not None:
                    levels[d.ilvl] = d
            abstract[aid] = levels

        # numId → abstractNumId, kèm lvlOverride
        for num in root.iterfind(qn("w:num")):
            num_id = num.get(qn("w:numId"))
            ref = num.find(qn("w:abstractNumId"))
            if num_id is None or ref is None:
                continue
            aid = ref.get(qn("w:val"))
            levels = dict(abstract.get(aid or "", {}))

            for ov in num.iterfind(qn("w:lvlOverride")):
                try:
                    ilvl = int(ov.get(qn("w:ilvl")) or "0")
                except ValueError:
                    continue
                start_ov = ov.find(qn("w:startOverride"))
                lvl_el = ov.find(qn("w:lvl"))
                if lvl_el is not None:
                    d = self._parse_level(lvl_el)
                    if d is not None:
                        levels[ilvl] = d
                if start_ov is not None and ilvl in levels:
                    base = levels[ilvl]
                    # startOverride hỏng thì giữ nguyên start gốc, không làm hỏng cả bộ đếm
                    with contextlib.suppress(ValueError):
                        levels[ilvl] = LevelDef(
                            base.ilvl,
                            int(start_ov.get(qn("w:val")) or base.start),
                            base.num_fmt,
                            base.lvl_text,
                            base.is_legal,
                        )

            for ilvl, d in levels.items():
                self._levels[(num_id, ilvl)] = d

    @staticmethod
    def _parse_level(lvl: _Element) -> LevelDef | None:
        try:
            ilvl = int(lvl.get(qn("w:ilvl")) or "0")
        except ValueError:
            return None

        def val(tag: str, default: str = "") -> str:
            el = lvl.find(qn(tag))
            return (el.get(qn("w:val")) if el is not None else None) or default

        try:
            start = int(val("w:start", "1"))
        except ValueError:
            start = 1

        is_lgl = lvl.find(qn("w:isLgl")) is not None
        return LevelDef(
            ilvl=ilvl,
            start=start,
            num_fmt=val("w:numFmt", "decimal"),
            lvl_text=val("w:lvlText"),
            is_legal=is_lgl,
        )

    def _load_styles(self, pkg: DocxPackage) -> None:
        root = pkg.tree_or_none(STYLES_PART)
        if root is None:
            return
        for style in root.iterfind(qn("w:style")):
            sid = style.get(qn("w:styleId"))
            if sid is None:
                continue
            based = style.find(qn("w:basedOn"))
            if based is not None and based.get(qn("w:val")):
                self._style_parent[sid] = based.get(qn("w:val"))  # type: ignore[arg-type]
            numpr = style.find(f"{qn('w:pPr')}/{qn('w:numPr')}")
            if numpr is not None:
                got = self._read_numpr(numpr)
                if got is not None:
                    self._style_numpr[sid] = got

    @staticmethod
    def _read_numpr(numpr: _Element) -> NumPr | None:
        num_el = numpr.find(qn("w:numId"))
        ilvl_el = numpr.find(qn("w:ilvl"))
        num_id = num_el.get(qn("w:val")) if num_el is not None else None
        if not num_id or num_id == "0":  # numId=0 nghĩa là GỠ đánh số
            return None
        try:
            ilvl = int((ilvl_el.get(qn("w:val")) if ilvl_el is not None else "0") or "0")
        except ValueError:
            ilvl = 0
        return NumPr(num_id=num_id, ilvl=ilvl)

    # ── Resolve cho một đoạn ──────────────────────────────────────────────
    def numpr_of(self, para: _Element) -> NumPr | None:
        """Ưu tiên numPr đặt trực tiếp trên đoạn; không có thì lấy từ style (có kế thừa)."""
        direct = para.find(f"{qn('w:pPr')}/{qn('w:numPr')}")
        if direct is not None:
            got = self._read_numpr(direct)
            if got is not None:
                return got
            # numId=0 trên đoạn = cố ý gỡ đánh số, KHÔNG fallback sang style
            num_el = direct.find(qn("w:numId"))
            if num_el is not None and num_el.get(qn("w:val")) == "0":
                return None

        style_el = para.find(f"{qn('w:pPr')}/{qn('w:pStyle')}")
        sid = style_el.get(qn("w:val")) if style_el is not None else None
        seen: set[str] = set()
        while sid and sid not in seen:
            seen.add(sid)
            if sid in self._style_numpr:
                return self._style_numpr[sid]
            sid = self._style_parent.get(sid)
        return None

    # ── Resolve toàn tài liệu ─────────────────────────────────────────────
    def resolve(self, paragraphs: list[_Element]) -> dict[int, str]:
        """
        Nhận danh sách `w:p` THEO ĐÚNG THỨ TỰ TÀI LIỆU.
        Trả về {chỉ số đoạn: nhãn}. Đoạn không được đánh số thì không có khoá.
        """
        counters: dict[tuple[str, int], int] = {}
        labels: dict[int, str] = {}

        for idx, para in enumerate(paragraphs):
            numpr = self.numpr_of(para)
            if numpr is None:
                continue
            level = self._levels.get((numpr.num_id, numpr.ilvl))
            if level is None or level.num_fmt in ("none", "bullet"):
                continue

            key = (numpr.num_id, numpr.ilvl)
            counters[key] = counters.get(key, level.start - 1) + 1

            # Tăng một mức thì RESET mọi mức sâu hơn của cùng numId
            for deeper in [k for k in counters if k[0] == numpr.num_id and k[1] > numpr.ilvl]:
                del counters[deeper]

            label = self._render(level, numpr, counters)
            if label:
                labels[idx] = label

        return labels

    def _render(
        self,
        level: LevelDef,
        numpr: NumPr,
        counters: dict[tuple[str, int], int],
    ) -> str:
        """Thay %1..%9 trong lvlText bằng giá trị đếm của mức tương ứng."""
        out = level.lvl_text
        for placeholder_lvl in range(1, 10):
            token = f"%{placeholder_lvl}"
            if token not in out:
                continue
            ilvl = placeholder_lvl - 1  # %1 ứng với ilvl 0
            value = counters.get((numpr.num_id, ilvl))
            if value is None:
                ref = self._levels.get((numpr.num_id, ilvl))
                value = ref.start if ref else 1
            fmt = (
                "decimal"
                if level.is_legal
                else (
                    self._levels[(numpr.num_id, ilvl)].num_fmt
                    if (numpr.num_id, ilvl) in self._levels
                    else "decimal"
                )
            )
            out = out.replace(token, format_counter(value, fmt))
        return out.strip()
