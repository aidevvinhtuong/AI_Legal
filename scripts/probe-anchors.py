#!/usr/bin/env python3
"""
probe-anchors.py — thăm dò các ứng viên ANCHOR ổn định trong một file .docx.

Trả lời 3 câu hỏi thiết kế của Technical Solution:
  1. Có `w14:paraId` / `w14:textId` không?  → anchor cấp đoạn cho comment + marker kéo-thả
  2. `w:permStart/@w:id` có duy nhất không?  → anchor cấp vùng mở cho write-back
  3. Vùng mở nào bắc qua ranh giới bảng / rỗng / đa đoạn? → phân loại atomic_field vs block_region

Chỉ đọc, không ghi. Dùng stdlib (zipfile + ElementTree), không cần pip.

    python3 scripts/probe-anchors.py <file.docx>
"""
from __future__ import annotations

import hashlib
import re
import sys
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"


def q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def para_text(p: ET.Element) -> str:
    return re.sub(r"\s+", " ", "".join(t.text or "" for t in p.iter(q(W, "t")))).strip()


def main(path: str) -> int:
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        doc = ET.fromstring(z.read("word/document.xml"))
        settings = z.read("word/settings.xml") if "word/settings.xml" in names else b""

    body = doc.find(q(W, "body"))
    paragraphs = list(body.iter(q(W, "p")))

    print("=" * 78)
    print(path)
    print("=" * 78)

    # --- 1. w14:paraId ---------------------------------------------------
    para_ids = [p.get(q(W14, "paraId")) for p in paragraphs]
    have = [x for x in para_ids if x and x != "00000000"]
    dupes = [k for k, v in Counter(have).items() if v > 1]
    print(f"\n-- w14:paraId ------------------------------------------------")
    print(f"  đoạn                 : {len(paragraphs)}")
    print(f"  có paraId hợp lệ     : {len(have)} ({len(have) * 100 // max(len(paragraphs), 1)}%)")
    print(f"  paraId trùng         : {len(dupes)}")
    print(f"  w14:textId           : {sum(1 for p in paragraphs if p.get(q(W14, 'textId')))}")
    print(f"  rsid trên đoạn       : {sum(1 for p in paragraphs if p.get(q(W, 'rsidR')))}")
    if have[:5]:
        print(f"  mẫu                  : {', '.join(have[:5])}")
    verdict = "DÙNG ĐƯỢC" if len(have) == len(paragraphs) and not dupes else "KHÔNG ĐỦ PHỦ"
    print(f"  → anchor cấp đoạn    : {verdict}")

    # --- 2. permStart/permEnd -------------------------------------------
    starts = [e for e in body.iter(q(W, "permStart"))]
    ends = [e for e in body.iter(q(W, "permEnd"))]
    sids = [e.get(q(W, "id")) for e in starts]
    print(f"\n-- w:permStart / w:permEnd -----------------------------------")
    print(f"  permStart            : {len(starts)}")
    print(f"  permEnd              : {len(ends)}")
    print(f"  id duy nhất          : {len(set(sids))}/{len(sids)}")
    print(f"  ed/edGrp             : {Counter((e.get(q(W, 'ed')) or e.get(q(W, 'edGrp')) or '-') for e in starts)}")
    print(f"  → anchor cấp vùng mở : {'DÙNG ĐƯỢC' if len(set(sids)) == len(sids) else 'ID TRÙNG — KHÔNG DÙNG ĐƯỢC'}")

    # --- 3. phân loại vùng mở --------------------------------------------
    # duyệt document theo thứ tự tài liệu, ghi nhận đoạn/bảng chứa mỗi mốc
    order: list[tuple[str, str, ET.Element]] = []

    # Một vùng mở có thể bắt đầu/kết thúc NGAY TRONG lòng một đoạn (inline field
    # kiểu "03 ngày"), hoặc bao trọn nhiều đoạn (block). Phải phát sinh sự kiện
    # p_begin → các mốc inline theo đúng thứ tự → p_end, rồi quy đoạn cho mọi
    # perm còn active tại BẤT KỲ thời điểm nào bên trong đoạn đó. Nếu chỉ ghi
    # nhận perm active ở mốc p_begin thì toàn bộ inline field bị đếm nhầm = rỗng.
    def walk(node: ET.Element, in_tbl: int = 0) -> None:
        for child in node:
            tag = child.tag
            if tag == q(W, "tbl"):
                walk(child, in_tbl + 1)
            elif tag == q(W, "p"):
                order.append(("p_begin", str(in_tbl), child))
                for sub in child.iter():
                    if sub.tag == q(W, "permStart"):
                        order.append(("start", sub.get(q(W, "id")) or "", sub))
                    elif sub.tag == q(W, "permEnd"):
                        order.append(("end", sub.get(q(W, "id")) or "", sub))
                order.append(("p_end", str(in_tbl), child))
            elif tag in (q(W, "permStart"), q(W, "permEnd")):
                kind = "start" if tag == q(W, "permStart") else "end"
                order.append((kind, child.get(q(W, "id")) or "", child))
            else:
                walk(child, in_tbl)

    walk(body)

    print(f"\n-- Phân loại 'vùng mở' ---------------------------------------")
    print(f"  {'perm id':<12} {'đoạn':>5} {'ký tự':>7} {'bảng':>5}  loại")
    open_paras: dict[str, list[ET.Element]] = {}
    depth: dict[str, int] = {}
    active: set[str] = set()
    i = 0
    while i < len(order):
        kind, val, el = order[i]
        if kind != "p_begin":
            if kind == "start":
                active.add(val)
                open_paras.setdefault(val, [])
                depth.setdefault(val, 0)
            elif kind == "end":
                active.discard(val)
            i += 1
            continue

        # Gom toàn bộ sự kiện của đoạn này cho tới p_end, rồi quy đoạn cho MỌI
        # perm active tại bất kỳ thời điểm nào bên trong — kể cả perm mở và
        # đóng gọn trong lòng đoạn (inline field). Mỗi đoạn tính đúng 1 lần.
        tbl_lvl = int(val)
        touched = set(active)
        j = i + 1
        while j < len(order) and order[j][0] != "p_end":
            k2, v2, _ = order[j]
            if k2 == "start":
                active.add(v2)
                open_paras.setdefault(v2, [])
                depth.setdefault(v2, tbl_lvl)
                touched.add(v2)
            elif k2 == "end":
                active.discard(v2)
            j += 1

        for pid in touched:
            open_paras.setdefault(pid, []).append(el)
            if depth.get(pid, tbl_lvl) != tbl_lvl:
                depth[pid] = -1  # bắc qua ranh giới bảng
        i = j + 1

    counts: Counter[str] = Counter()
    for pid, ps in open_paras.items():
        text = " ".join(para_text(p) for p in ps).strip()
        n_para, n_char = len(ps), len(text)
        if n_char == 0:
            kind = "EMPTY (không có run để kế thừa rPr)"
        elif depth.get(pid, 0) == -1:
            kind = "BLOCK/CROSS-TABLE (write-back khó nhất)"
        elif n_para <= 1 and n_char <= 120:
            kind = "atomic_field"
        else:
            kind = "block_region"
        counts[kind.split()[0]] += 1
        tbl = "có" if depth.get(pid, 0) not in (0, -1) else ("bắc" if depth.get(pid) == -1 else "-")
        print(f"  {pid:<12} {n_para:>5} {n_char:>7} {tbl:>5}  {kind}")

    print(f"\n  tổng hợp: {dict(counts)}")

    # --- 4. settings / protection ---------------------------------------
    prot = re.search(rb"<w:documentProtection\b([^>]*)>", settings)
    print(f"\n-- settings.xml ----------------------------------------------")
    print(f"  documentProtection   : {prot.group(1).decode('utf-8', 'replace').strip() if prot else 'KHÔNG CÓ'}")
    print(f"  rsid                 : {len(re.findall(rb'<w:rsid ', settings))}")
    print(f"  trackChanges bật     : {b'<w:trackChanges' in settings}")

    # --- 5. các part liên quan -------------------------------------------
    print(f"\n-- các part trong gói ----------------------------------------")
    for n in sorted(names):
        if n.startswith("word/") and n.endswith(".xml"):
            print(f"  {n}")

    print(f"\n-- fingerprint vùng khoá (ví dụ thuật toán) -------------------")
    locked = [para_text(p) for p in paragraphs if p not in set(sum(open_paras.values(), []))]
    norm = "\n".join(t for t in locked if t)
    print(f"  đoạn khoá            : {len(locked)}")
    print(f"  sha256(normalized)   : {hashlib.sha256(norm.encode()).hexdigest()}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
