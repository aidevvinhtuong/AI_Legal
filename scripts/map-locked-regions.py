#!/usr/bin/env python3
"""Bản đồ vùng KHOÁ / MỞ của một hợp đồng .docx dùng Range Permission.

Vùng khoá = phần bù của các range w:permStart/w:permEnd khi documentProtection
ở chế độ readOnly. Đây chính là allow-list âm bản: mọi thứ KHÔNG nằm trong
perm range là vùng AI và người dùng tuyệt đối không được ghi.

Kèm bộ resolve numbering (prototype) để khôi phục số điều khoản do Word sinh ra
từ styles.xml + numbering.xml — vì số điều KHÔNG nằm trong luồng text.

Usage:
    python3 scripts/map-locked-regions.py <file.docx>
    python3 scripts/map-locked-regions.py --locked-only <file.docx>
    python3 scripts/map-locked-regions.py --outline <file.docx>   # chỉ heading
"""

from __future__ import annotations

import re
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
ROMAN = [
    (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"),
    (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
]


def q(t: str) -> str:
    return f"{{{W}}}{t}"


def val(el, a: str = "val"):
    return el.get(q(a)) if el is not None else None


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def to_roman(n: int) -> str:
    out = []
    for v, s in ROMAN:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


def fmt_num(n: int, fmt: str) -> str:
    if fmt == "lowerLetter":
        return chr(ord("a") + (n - 1) % 26)
    if fmt == "upperLetter":
        return chr(ord("A") + (n - 1) % 26)
    if fmt == "lowerRoman":
        return to_roman(n)
    if fmt == "upperRoman":
        return to_roman(n).upper()
    return str(n)


class Numbering:
    """Resolve số thứ tự điều khoản như Word render ra."""

    def __init__(self, z: zipfile.ZipFile):
        self.style_num: dict[str, tuple[str, int]] = {}
        self.levels: dict[str, dict[int, dict]] = {}
        self.counters: dict[tuple[str, int], int] = {}

        if "word/styles.xml" in z.namelist():
            for s in ET.fromstring(z.read("word/styles.xml")).findall("w:style", NS):
                ppr = s.find("w:pPr", NS)
                np = ppr.find("w:numPr", NS) if ppr is not None else None
                if np is None:
                    continue
                nid = val(np.find("w:numId", NS))
                ilvl = val(np.find("w:ilvl", NS))
                if nid:
                    self.style_num[val(s, "styleId")] = (nid, int(ilvl or 0))

        if "word/numbering.xml" in z.namelist():
            nroot = ET.fromstring(z.read("word/numbering.xml"))
            abs_map = {}
            for an in nroot.findall("w:abstractNum", NS):
                lv = {}
                for l in an.findall("w:lvl", NS):
                    i = int(val(l, "ilvl") or 0)
                    lv[i] = {
                        "fmt": val(l.find("w:numFmt", NS)) or "decimal",
                        "text": val(l.find("w:lvlText", NS)) or "",
                        "start": int(val(l.find("w:start", NS)) or 1),
                    }
                abs_map[val(an, "abstractNumId")] = lv
            for n in nroot.findall("w:num", NS):
                aid = val(n.find("w:abstractNumId", NS))
                if aid in abs_map:
                    self.levels[val(n, "numId")] = abs_map[aid]

    def resolve(self, num_id: str | None, ilvl: int) -> str:
        """Tăng bộ đếm và trả về nhãn số (vd 'Điều 4.', '4.1', 'a.', '(i)')."""
        if not num_id or num_id == "0" or num_id not in self.levels:
            return ""
        lv = self.levels[num_id]
        if ilvl not in lv:
            return ""
        key = (num_id, ilvl)
        self.counters[key] = self.counters.get(key, lv[ilvl]["start"] - 1) + 1
        for deeper in [k for k in self.counters if k[0] == num_id and k[1] > ilvl]:
            self.counters.pop(deeper, None)

        label = lv[ilvl]["text"]
        for i in range(ilvl + 1):
            cnt = self.counters.get((num_id, i))
            if cnt is None:
                cnt = lv.get(i, {}).get("start", 1)
            label = label.replace(f"%{i + 1}", fmt_num(cnt, lv.get(i, {}).get("fmt", "decimal")))
        return label


def build_map(path: str):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find("w:body", NS)
    numbering = Numbering(z)

    dp = ET.fromstring(z.read("word/settings.xml")).find("w:documentProtection", NS) \
        if "word/settings.xml" in z.namelist() else None

    tbl_paras = {id(p) for tbl in body.iter(q("tbl")) for p in tbl.iter(q("p"))}

    rows = []
    active: list[str] = []
    para_no = 0
    cur: dict | None = None

    def flush():
        """Chốt paragraph đang gom vào rows."""
        if cur is None:
            return
        pieces = cur["pieces"]
        text = norm("".join(s for _, s in pieces))
        if not text and not cur["label"]:
            return
        zones = {z_ for z_, s in pieces if s.strip()}
        zone = ("open" if zones == {"open"}
                else "locked" if zones == {"locked"} or not zones
                else "mixed")
        rows.append({
            "para": cur["no"],
            "zone": zone,
            "label": cur["label"],
            "style": cur["style"] or "",
            "in_table": cur["in_table"],
            "text": text,
            "open_chars": sum(len(s) for z_, s in pieces if z_ == "open"),
            "locked_chars": sum(len(s) for z_, s in pieces if z_ == "locked"),
        })

    # MỘT lượt duyệt pre-order trên toàn body — bắt buộc, vì permStart/permEnd
    # có thể nằm ngoài w:p (ở cấp body hoặc trong w:tbl), và một range có thể
    # bắc qua nhiều paragraph. Quét theo từng paragraph riêng lẻ sẽ bỏ sót
    # marker và làm cả tài liệu bị coi là vùng mở.
    for node in body.iter():
        tag = node.tag
        if tag == q("p"):
            flush()
            para_no += 1
            ppr = node.find("w:pPr", NS)
            style = val(ppr.find("w:pStyle", NS)) if ppr is not None else None
            num_id, ilvl = None, 0
            direct = ppr.find("w:numPr", NS) if ppr is not None else None
            if direct is not None:
                num_id = val(direct.find("w:numId", NS))
                ilvl = int(val(direct.find("w:ilvl", NS)) or 0)
            elif style in numbering.style_num:
                num_id, ilvl = numbering.style_num[style]
            cur = {
                "no": para_no,
                "style": style,
                "label": numbering.resolve(num_id, ilvl),
                "in_table": id(node) in tbl_paras,
                "pieces": [],
            }
        elif tag == q("permStart"):
            active.append(val(node, "id"))
        elif tag == q("permEnd"):
            rid = val(node, "id")
            if rid in active:
                active.remove(rid)
        elif tag in (q("t"), q("tab")) and cur is not None:
            s = (node.text or "") if tag == q("t") else " "
            cur["pieces"].append(("open" if active else "locked", s))
    flush()

    return rows, dp


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1
    locked_only = "--locked-only" in sys.argv
    outline = "--outline" in sys.argv
    path = args[0]

    rows, dp = build_map(path)
    total_open = sum(r["open_chars"] for r in rows)
    total_locked = sum(r["locked_chars"] for r in rows)
    total = total_open + total_locked

    print("=" * 96)
    print(path)
    print("=" * 96)
    if dp is not None:
        print(f"documentProtection: edit={val(dp,'edit')} enforcement={val(dp,'enforcement')} "
              f"password={'CÓ' if (val(dp,'hash') or val(dp,'salt')) else 'KHÔNG'}")
    print(f"Tổng {total} ký tự  |  KHOÁ {total_locked} ({total_locked/total:.1%})  "
          f"|  MỞ {total_open} ({total_open/total:.1%})")
    print(f"{len(rows)} đoạn có nội dung\n")

    if outline:
        print("--- DÀN Ý ĐIỀU KHOẢN (số điều đã resolve từ numbering.xml) ---")
        for r in rows:
            if not r["label"] or not r["style"].startswith("Heading"):
                continue
            depth = {"Heading1": 0, "Heading2": 1, "Heading3": 2, "Heading4": 3}.get(r["style"], 0)
            mark = {"open": "MỞ  ", "locked": "KHOÁ", "mixed": "HỖN "}[r["zone"]]
            print(f"  [{mark}] {'  ' * depth}{r['label']} {r['text'][:80]}")
        return 0

    print("--- BẢN ĐỒ KHOÁ / MỞ ---")
    print("    (KHOÁ = AI và người dùng TUYỆT ĐỐI không được ghi)\n")
    run_zone = None
    for r in rows:
        if locked_only and r["zone"] == "open":
            continue
        if r["zone"] != run_zone:
            run_zone = r["zone"]
            banner = {"open": "VÙNG MỞ", "locked": "VÙNG KHOÁ", "mixed": "ĐOẠN HỖN HỢP"}[run_zone]
            print(f"\n  ##### {banner} " + "#" * (60 - len(banner)))
        mark = {"open": "MỞ  ", "locked": "KHOÁ", "mixed": "HỖN "}[r["zone"]]
        tbl = " [bảng]" if r["in_table"] else ""
        lbl = f"{r['label']} " if r["label"] else ""
        print(f"  [{mark}] p{r['para']:>3}{tbl} {lbl}{r['text'][:110]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
