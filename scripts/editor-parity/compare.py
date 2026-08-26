"""
Đối chiếu text đoạn: SuperDoc (trình duyệt) vs OoxmlReader (backend).

Chạy trong container `api`. Đọc JSON của `extract.mjs` từ đối số 1, `.docx` từ
đối số 2. Thoát khác 0 nếu có đoạn lệch.
"""

from __future__ import annotations

import json
import sys

from app.services.document.ooxml import DocxPackage
from app.services.document.ooxml_reader import OoxmlReader


def main() -> int:
    with open(sys.argv[1], encoding="utf-8") as fh:
        pm = json.load(fh)
    with open(sys.argv[2], "rb") as fh:
        blob = fh.read()
    be = OoxmlReader().read(DocxPackage.load(blob)).paragraphs

    by_id: dict[str, list[str]] = {}
    for item in pm:
        by_id.setdefault(item["paraId"] or "", []).append(item["text"])

    matched = mismatched = missing = 0
    samples: list[tuple[str, str, str]] = []
    for para in be:
        texts = by_id.get(para.para_id)
        if not texts:
            missing += 1
            continue
        if para.text in texts:
            matched += 1
        else:
            mismatched += 1
            if len(samples) < 5:
                samples.append((para.para_id, para.text, texts[0]))

    print(f"SuperDoc {len(pm)} đoạn · backend {len(be)} đoạn")
    print(f"khớp {matched} · LỆCH {mismatched} · thiếu paraId {missing}")
    for pid, backend_text, editor_text in samples:
        print(f"\n  [{pid}]")
        print(f"    backend  {backend_text[:110]!r}")
        print(f"    superdoc {editor_text[:110]!r}")
        if " ".join(backend_text.split()) == " ".join(editor_text.split()):
            print("    → chỉ khác KHOẢNG TRẮNG (thường là w:tab / w:br)")

    return 0 if (mismatched == 0 and missing == 0) else 1


if __name__ == "__main__":
    raise SystemExit(main())
