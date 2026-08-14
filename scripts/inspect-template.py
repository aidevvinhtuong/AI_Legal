#!/usr/bin/env python3
"""Chẩn đoán cấu trúc khoá/mở của một hợp đồng / template .docx.

Báo cáo cơ chế vùng mở (Range Permission / Content Control / Legacy Form Field),
trạng thái Restrict Editing, inventory và nội dung từng vùng mở, vị trí neo của
comment, khả năng resolve số điều khoản, và một số kiểm tra nhất quán cơ bản.

Dùng để: (1) chốt Word engine, (2) kiểm tra template khi Legal đăng ký bản mới,
(3) sinh dữ liệu đầu vào cho bước đặt tên / phân loại vùng mở.

Usage:
    python3 scripts/inspect-template.py <file.docx> [file2.docx ...]
    python3 scripts/inspect-template.py --json <file.docx>
    python3 scripts/inspect-template.py --quiet <file.docx>   # bỏ nội dung vùng mở
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from collections import Counter
from dataclasses import asdict, dataclass, field
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
LOCKED_VALUES = {"sdtLocked", "sdtContentLocked", "contentLocked"}
SDT_TYPES = {
    "text", "richText", "comboBox", "dropDownList", "date",
    "picture", "checkbox", "docPartList", "repeatingSection",
}


def q(tag: str) -> str:
    return f"{{{W}}}{tag}"


def val(el, attr: str = "val"):
    return el.get(q(attr)) if el is not None else None


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def text_of(el) -> str:
    out = []
    for n in el.iter():
        if n.tag == q("t"):
            out.append(n.text or "")
        elif n.tag == q("tab"):
            out.append(" ")
    return norm("".join(out))


@dataclass
class Report:
    file: str
    mechanism: str = "unknown"
    document_protection: dict | None = None
    perm_ranges: list = field(default_factory=list)
    content_controls: list = field(default_factory=list)
    legacy_form_fields: list = field(default_factory=list)
    comments: list = field(default_factory=list)
    tracked_revisions: dict = field(default_factory=dict)
    numbering: dict = field(default_factory=dict)
    stats: dict = field(default_factory=dict)
    consistency: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Parsers
# --------------------------------------------------------------------------- #

def parse_protection(z: zipfile.ZipFile) -> dict | None:
    if "word/settings.xml" not in z.namelist():
        return None
    dp = ET.fromstring(z.read("word/settings.xml")).find("w:documentProtection", NS)
    if dp is None:
        return None
    return {
        "edit": val(dp, "edit"),
        "enforcement": val(dp, "enforcement"),
        "formatting": val(dp, "formatting"),
        "has_password_hash": bool(val(dp, "hash") or val(dp, "salt")),
    }


def parse_numbering(z: zipfile.ZipFile, rep: Report) -> None:
    """Xác định số điều khoản có nằm trong text hay do Word sinh ra."""
    styled = {}
    if "word/styles.xml" in z.namelist():
        sroot = ET.fromstring(z.read("word/styles.xml"))
        for s in sroot.findall("w:style", NS):
            ppr = s.find("w:pPr", NS)
            if ppr is None:
                continue
            np = ppr.find("w:numPr", NS)
            if np is None:
                continue
            styled[val(s, "styleId")] = {
                "numId": val(np.find("w:numId", NS)),
                "ilvl": val(np.find("w:ilvl", NS)),
            }

    fmts = {}
    if "word/numbering.xml" in z.namelist():
        nroot = ET.fromstring(z.read("word/numbering.xml"))
        num_to_abs = {
            val(n, "numId"): val(n.find("w:abstractNumId", NS))
            for n in nroot.findall("w:num", NS)
        }
        abs_lvls = {}
        for an in nroot.findall("w:abstractNum", NS):
            abs_lvls[val(an, "abstractNumId")] = [
                f"lvl{val(l, 'ilvl')}={val(l.find('w:lvlText', NS))}"
                for l in an.findall("w:lvl", NS)[:4]
            ]
        for nid, aid in num_to_abs.items():
            if aid in abs_lvls:
                fmts[nid] = abs_lvls[aid]

    rep.numbering = {
        "styles_with_numbering": styled,
        "level_formats": {k: v for k, v in fmts.items() if k in
                          {s["numId"] for s in styled.values()}},
    }


def collect(z: zipfile.ZipFile, rep: Report, quiet: bool) -> None:
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find("w:body", NS)

    tbl_paras = {id(p) for tbl in body.iter(q("tbl")) for p in tbl.iter(q("p"))}

    # Duyệt pre-order = thứ tự tài liệu.
    active_perm: list[str] = []
    active_cmt: list[str] = []
    regions: dict[str, dict] = {}
    order: list[str] = []
    stream: list[str] = []
    bounds: dict[str, list] = {}
    cmt_anchor: dict[str, dict] = {}
    styles = Counter()
    para_no = 0
    cur_in_table = False

    for node in body.iter():
        tag = node.tag
        if tag == q("p"):
            para_no += 1
            cur_in_table = id(node) in tbl_paras
            ppr = node.find("w:pPr", NS)
            styles[(val(ppr.find("w:pStyle", NS)) if ppr is not None else None)
                   or "(Normal)"] += 1
            stream.append("\n")
            for rid in active_perm:
                regions[rid]["text"].append(" ")
                regions[rid]["in_table"].add(cur_in_table)
        elif tag == q("permStart"):
            rid = val(node, "id")
            regions[rid] = {
                "id": rid,
                "edGrp": val(node, "edGrp"),
                "ed": val(node, "ed"),
                "text": [],
                "in_table": {cur_in_table},
                "start_para": para_no,
            }
            bounds[rid] = [len("".join(stream)), None]
            active_perm.append(rid)
            order.append(rid)
        elif tag == q("permEnd"):
            rid = val(node, "id")
            if rid in active_perm:
                active_perm.remove(rid)
            if rid in bounds:
                bounds[rid][1] = len("".join(stream))
                regions[rid]["end_para"] = para_no
        elif tag == q("commentRangeStart"):
            cid = val(node, "id")
            active_cmt.append(cid)
            cmt_anchor[cid] = {
                "para": para_no,
                "in_perm": list(active_perm),
                "zone": "open" if active_perm else "locked",
            }
        elif tag == q("commentRangeEnd"):
            cid = val(node, "id")
            if cid in active_cmt:
                active_cmt.remove(cid)
        elif tag in (q("t"), q("tab")):
            s = (node.text or "") if tag == q("t") else " "
            stream.append(s)
            for rid in active_perm:
                regions[rid]["text"].append(s)
        elif tag == q("sdt"):
            pr = node.find("w:sdtPr", NS)
            content = node.find("w:sdtContent", NS)
            lock = val(pr.find("w:lock", NS)) if pr is not None else None
            types = [c.tag.split("}")[-1] for c in (pr or [])
                     if c.tag.split("}")[-1] in SDT_TYPES]
            rep.content_controls.append({
                "tag": val(pr.find("w:tag", NS)) if pr is not None else None,
                "alias": val(pr.find("w:alias", NS)) if pr is not None else None,
                "type": types[0] if types else "unspecified",
                "lock": lock or "unlocked",
                "locked": lock in LOCKED_VALUES if lock else False,
                "value_preview": text_of(content)[:80] if content is not None else "",
            })
        elif tag == q("ffData"):
            kind = ("checkbox" if node.find("w:checkBox", NS) is not None
                    else "dropdown" if node.find("w:ddList", NS) is not None
                    else "text")
            rep.legacy_form_fields.append({
                "name": val(node.find("w:name", NS)),
                "type": kind,
            })

    full = "".join(stream)

    for rid in order:
        r = regions[rid]
        s, e = bounds[rid]
        content = norm("".join(r["text"]))
        rep.perm_ranges.append({
            "id": rid,
            "edGrp": r["edGrp"],
            "length": len(content),
            "in_table": True in r["in_table"],
            "spans_table_boundary": len(r["in_table"]) > 1,
            "start_para": r["start_para"],
            "end_para": r.get("end_para"),
            "closed": e is not None,
            "content": "" if quiet else content[:400],
            "context_before": "" if quiet else norm(full[max(0, s - 220):s])[-200:],
        })
        if e is None:
            rep.warnings.append(f"permStart id={rid} không có permEnd tương ứng")

    # Comments
    if "word/comments.xml" in z.namelist():
        croot = ET.fromstring(z.read("word/comments.xml"))
        for c in croot.findall("w:comment", NS):
            cid = val(c, "id")
            a = cmt_anchor.get(cid, {})
            rep.comments.append({
                "id": cid,
                "author": c.get(q("author")),
                "date": c.get(q("date")),
                "zone": a.get("zone", "unknown"),
                "in_perm": a.get("in_perm", []),
                "para": a.get("para"),
                "text": "" if quiet else text_of(c)[:200],
            })

    rep.tracked_revisions = {
        "insertions": sum(1 for _ in body.iter(q("ins"))),
        "deletions": sum(1 for _ in body.iter(q("del"))),
    }
    rep.stats = {
        "paragraphs": para_no,
        "tables": sum(1 for _ in body.iter(q("tbl"))),
        "media": sum(1 for n in z.namelist() if n.startswith("word/media/")),
        "text_chars": len(full),
        "styles": dict(styles.most_common()),
        "headers_footers": [
            n for n in z.namelist()
            if re.match(r"word/(header|footer)\d*\.xml", n)
        ],
    }

    # Kiểm tra nhất quán số tiền bằng số vs bằng chữ (loại lỗi hay gặp).
    seen: dict[str, set] = {}
    for m in re.finditer(
        r"([\d][\d.,]{5,})\s*VND[^)]{0,40}\(\s*Bằng chữ\s*:?\s*([^)]{5,90})\)",
        full, re.IGNORECASE,
    ):
        seen.setdefault(m.group(1), set()).add(norm(m.group(2)))
    for number, words in seen.items():
        rep.consistency.append({
            "number": number,
            "words_variants": sorted(words),
            "ok": len(words) == 1,
        })
        if len(words) > 1:
            rep.warnings.append(
                f"Số tiền {number} có {len(words)} cách ghi bằng chữ khác nhau "
                f"— nhiều khả năng SAI: {sorted(words)}"
            )


def decide_mechanism(rep: Report) -> None:
    if rep.perm_ranges:
        rep.mechanism = "range_permission"
    elif any(not c["locked"] for c in rep.content_controls):
        rep.mechanism = "content_control"
    elif rep.legacy_form_fields:
        rep.mechanism = "legacy_form_field"
    elif rep.content_controls:
        rep.mechanism = "content_control_all_locked"
    else:
        rep.mechanism = "none"


def lint(rep: Report) -> None:
    if rep.mechanism == "none":
        rep.warnings.append(
            "KHÔNG có cơ chế đánh dấu vùng mở nào — không thể phân biệt vùng "
            "khoá/mở từ OOXML. Template chưa dùng được cho write-back an toàn."
        )
    dp = rep.document_protection
    if dp is None:
        rep.warnings.append("Không có w:documentProtection — file KHÔNG bị Restrict Editing.")
    elif not dp.get("has_password_hash"):
        rep.warnings.append("Có documentProtection nhưng KHÔNG có password — user gỡ khoá dễ dàng.")
    for r in rep.perm_ranges:
        if r["length"] == 0:
            rep.warnings.append(f"Vùng mở id={r['id']} RỖNG (0 ký tự) — nhiều khả năng thừa.")
        if r["spans_table_boundary"]:
            rep.warnings.append(
                f"Vùng mở id={r['id']} bắc qua ranh giới bảng — write-back OOXML phức tạp."
            )
    if rep.tracked_revisions.get("insertions") or rep.tracked_revisions.get("deletions"):
        rep.warnings.append("File còn tracked changes chưa accept/reject — cần làm sạch.")
    if rep.numbering.get("styles_with_numbering"):
        rep.warnings.append(
            "Số điều khoản do Word sinh từ style + numbering.xml, KHÔNG nằm trong text. "
            "Trích xuất text thuần sẽ MẤT toàn bộ số điều — cần resolve numbering."
        )
    locked_cmt = [c for c in rep.comments if c["zone"] == "locked"]
    if locked_cmt:
        rep.warnings.append(
            f"{len(locked_cmt)} comment neo vào VÙNG KHOÁ — người duyệt đang yêu cầu "
            "sửa chỗ không sửa được. Cần đường escalate."
        )


def inspect(path: str, quiet: bool = False) -> Report:
    rep = Report(file=path)
    with zipfile.ZipFile(path) as z:
        rep.document_protection = parse_protection(z)
        parse_numbering(z, rep)
        collect(z, rep, quiet)
    decide_mechanism(rep)
    lint(rep)
    return rep


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #

def render(rep: Report) -> str:
    L: list[str] = []
    a = L.append
    st = rep.stats
    a(f"\n{'=' * 78}\n{rep.file}\n{'=' * 78}")
    a(f"CƠ CHẾ VÙNG MỞ : {rep.mechanism.upper()}")
    a(f"Quy mô          : {st['paragraphs']} đoạn · {st['tables']} bảng · "
      f"{st['media']} ảnh · {st['text_chars']} ký tự")

    dp = rep.document_protection
    a("\n-- Restrict Editing ----------------------------------------------------")
    a("  KHÔNG có documentProtection." if dp is None else
      f"  edit={dp['edit']}  enforcement={dp['enforcement']}  "
      f"password={'CÓ' if dp['has_password_hash'] else 'KHÔNG'}")

    a(f"\n-- Range Permission: {len(rep.perm_ranges)} vùng --------------------------------")
    for i, r in enumerate(rep.perm_ranges, 1):
        flags = []
        if r["in_table"]:
            flags.append("trong-bảng")
        if r["spans_table_boundary"]:
            flags.append("BẮC-QUA-BẢNG")
        if r["length"] == 0:
            flags.append("RỖNG")
        a(f"  [{i:>2}] id={r['id']:<11} len={r['length']:<5} "
          f"para {r['start_para']}–{r['end_para']} {' '.join(flags)}")
        if r["context_before"]:
            a(f"        ngữ cảnh: ...{r['context_before'][-110:]}")
        if r["content"]:
            a(f"        NỘI DUNG: {r['content'][:200]}")

    a(f"\n-- Content Control: {len(rep.content_controls)} ------------------------------------")
    for c in rep.content_controls[:30]:
        a(f"  tag={str(c['tag']):<22} type={c['type']:<12} lock={c['lock']}")

    a(f"\n-- Legacy Form Field: {len(rep.legacy_form_fields)} ----------------------------------")
    for f_ in rep.legacy_form_fields[:20]:
        a(f"  name={f_['name']} type={f_['type']}")

    a("\n-- Numbering (số điều khoản) -------------------------------------------")
    sw = rep.numbering.get("styles_with_numbering", {})
    if sw:
        for sid, info in sw.items():
            fmt = rep.numbering.get("level_formats", {}).get(info["numId"], [])
            a(f"  {sid:<12} numId={info['numId']} ilvl={info['ilvl']}  {' '.join(fmt)}")
    else:
        a("  Không có style nào mang numbering.")

    a(f"\n-- Comments: {len(rep.comments)} ------------------------------------------------")
    for c in rep.comments:
        a(f"  [{c['id']}] {c['author']} · {c['date']} · vùng={c['zone'].upper()} "
          f"perm={c['in_perm']}")
        if c["text"]:
            a(f"      {c['text'][:160]}")

    a(f"\n-- Tracked changes: +{rep.tracked_revisions.get('insertions', 0)} "
      f"/ -{rep.tracked_revisions.get('deletions', 0)}")

    if rep.consistency:
        a("\n-- Nhất quán số tiền (số vs bằng chữ) ----------------------------------")
        for c in rep.consistency:
            a(f"  {'OK ' if c['ok'] else 'SAI'} {c['number']} → {c['words_variants']}")

    if rep.warnings:
        a("\n-- CẢNH BÁO ------------------------------------------------------------")
        for w in rep.warnings:
            a(f"  ! {w}")
    return "\n".join(L)


def main() -> int:
    flags = {"--json", "--quiet"}
    args = [a for a in sys.argv[1:] if a not in flags]
    if not args:
        print(__doc__)
        return 1
    quiet = "--quiet" in sys.argv
    reports = [inspect(p, quiet) for p in args]
    if "--json" in sys.argv:
        print(json.dumps([asdict(r) for r in reports], ensure_ascii=False, indent=2))
    else:
        for r in reports:
            print(render(r))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
