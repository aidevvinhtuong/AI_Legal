#!/usr/bin/env python3
"""
dump-doc.py — chạy tầng đọc của backend trên một .docx và in kết quả.

Công cụ dev để mắt người xác nhận, khác với test tự động: test bảo "đúng như kỳ
vọng", còn cái này cho thấy kỳ vọng có hợp lý không.

    .venv/bin/python scripts/dump-doc.py <file.docx> [--segments] [--fields]
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.ai.segmenter import segment  # noqa: E402
from app.services.document.ooxml import DocxPackage  # noqa: E402
from app.services.document.ooxml_reader import OoxmlReader  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    path = Path(argv[0])
    show_seg = "--segments" in argv or not any(a.startswith("--") for a in argv[1:])
    show_fld = "--fields" in argv or not any(a.startswith("--") for a in argv[1:])

    pkg = DocxPackage.load(path.read_bytes())
    inv = OoxmlReader().read(pkg)

    print("=" * 78)
    print(path.name)
    print("=" * 78)
    prot = inv.protection
    print(f"cơ chế       : {inv.mechanism.value}")
    print(
        f"bảo vệ       : "
        + ("KHÔNG CÓ" if prot is None
           else f"{prot.edit} enforcement={prot.enforcement} "
                f"mật khẩu={'có' if prot.has_password else 'không'} "
                f"→ {'CÓ hiệu lực' if prot.is_effective else 'KHÔNG hiệu lực'}")
    )
    print(f"đoạn         : {len(inv.paragraphs)}")
    print(f"vùng mở      : {len(inv.fields)}  {inv.counts_by_kind()}")
    print(f"ghi được     : {len(inv.writable_perm_ids)}/{len(inv.fields)}")
    print(f"comment      : {inv.comment_count}")
    print(f"hash vùng khoá: {inv.locked_fingerprint()[:16]}…")

    if show_fld:
        print("\n-- VÙNG MỞ " + "-" * 60)
        print(f"  {'perm_id':<12} {'loại':<13} {'ghi':<4} {'đoạn':>4} {'ký tự':>6}  nội dung")
        for f in inv.fields:
            preview = f.inner_text.replace("\n", " ")[:44]
            print(
                f"  {f.perm_id:<12} {f.region_kind.value:<13} "
                f"{'✓' if f.writable else '✗':<4} {f.para_count:>4} {f.char_len:>6}  {preview}"
            )

    if show_seg:
        segs = segment(inv.paragraphs)
        print(f"\n-- SEGMENT: {len(segs)} " + "-" * 56)
        for s in segs:
            mark = "MỞ " if s.is_open else "   "
            print(f"  {mark}[L{s.level}] {s.citation[:52]:<52} {s.char_len:>6} ký tự")

        opened = [s for s in segs if s.is_open]
        print(f"\n  segment trong vùng mở: {len(opened)}/{len(segs)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
