#!/usr/bin/env python3
"""
dump-outline.py — rút cấu trúc & quy ước trình bày của một tài liệu .docx.

Dùng để lấy "khuôn" của Blueprint BA (đánh số mục, kiểu heading, cách dùng bảng)
làm template trình bày cho bộ Technical Solution.

Chỉ đọc, stdlib (zipfile + ElementTree), không cần pip.

    python3 scripts/dump-outline.py <file.docx> [--max-level N] [--tables]
"""
from __future__ import annotations

import re
import sys
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def text_of(p: ET.Element) -> str:
    return re.sub(r"\s+", " ", "".join(t.text or "" for t in p.iter(q("t")))).strip()


def style_of(p: ET.Element) -> str:
    ppr = p.find(q("pPr"))
    if ppr is None:
        return ""
    st = ppr.find(q("pStyle"))
    return st.get(q("val")) if st is not None else ""


def outline_level(style: str) -> int | None:
    m = re.fullmatch(r"Heading(\d)", style or "")
    if m:
        return int(m.group(1))
    if style in ("Title",):
        return 0
    return None


def main(argv: list[str]) -> int:
    path = argv[0]
    max_level = 9
    show_tables = "--tables" in argv
    if "--max-level" in argv:
        max_level = int(argv[argv.index("--max-level") + 1])

    with zipfile.ZipFile(path) as z:
        doc = ET.fromstring(z.read("word/document.xml"))
        styles_xml = z.read("word/styles.xml").decode("utf-8", "replace")

    body = doc.find(q("body"))

    print("=" * 78)
    print(path)
    print("=" * 78)

    # --- cấu trúc heading -------------------------------------------------
    print("\n-- DÀN Ý (heading) -------------------------------------------")
    style_counter: Counter[str] = Counter()
    shown = 0
    for p in body.iter(q("p")):
        st = style_of(p)
        style_counter[st or "(Normal)"] += 1
        lvl = outline_level(st)
        if lvl is None or lvl > max_level:
            continue
        txt = text_of(p)
        if not txt:
            continue
        print(f"{'  ' * lvl}{'#' * max(lvl, 1)} {txt}")
        shown += 1
    print(f"\n  ({shown} heading)")

    # --- thống kê style ---------------------------------------------------
    print("\n-- STYLE ĐOẠN HAY DÙNG ---------------------------------------")
    for st, n in style_counter.most_common(15):
        print(f"  {n:>5}  {st}")

    # --- bảng --------------------------------------------------------------
    tables = list(body.iter(q("tbl")))
    print(f"\n-- BẢNG: {len(tables)} ----------------------------------------")
    if show_tables:
        for i, tbl in enumerate(tables[:40], 1):
            rows = list(tbl.iter(q("tr")))
            if not rows:
                continue
            header = [text_of(c)[:28] for c in rows[0].iter(q("tc"))]
            print(f"  [{i:>2}] {len(rows)} hàng × {len(header)} cột | {' | '.join(header)}")

    # --- style định nghĩa trong styles.xml ---------------------------------
    print("\n-- STYLE ĐỊNH NGHĨA ------------------------------------------")
    for m in re.finditer(r'w:styleId="([^"]+)"', styles_xml):
        pass
    ids = sorted({m.group(1) for m in re.finditer(r'w:styleId="([^"]+)"', styles_xml)})
    print("  " + ", ".join(ids[:60]))

    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1:]))
