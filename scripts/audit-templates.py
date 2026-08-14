#!/usr/bin/env python3
"""
audit-templates.py — kiểm định template hợp đồng khung có đạt chuẩn để đưa vào
hệ thống AI Legal hay không.

Đây là bản chạy CLI của tính năng "đăng ký template có báo cáo chẩn đoán"
(TS-04 mục VI.5). Logic ở đây sẽ được port thẳng vào
`backend/app/services/document/structural_binding.py`.

    python3 scripts/audit-templates.py <file.docx> [file2.docx ...]
    python3 scripts/audit-templates.py --md > docs/template-audit.md
"""
from __future__ import annotations

import re
import sys
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"

# Ngưỡng chuẩn — hiệu chỉnh được khi Legal chốt
MIN_OPEN_REGIONS = 3          # ít hơn ⇒ không điền nổi hợp đồng
MAX_EMPTY_REGIONS = 0         # vùng mở rỗng là rác trong template
ATOMIC_MAX_CHARS = 200


def q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


@dataclass
class Finding:
    level: str          # BLOCK | WARN | INFO
    code: str
    message: str
    fix: str = ""


@dataclass
class Audit:
    path: Path
    mechanism: str = "none"
    paragraphs: int = 0
    para_ids_ok: int = 0
    para_ids_dup: int = 0
    perm_ids: list[str] = field(default_factory=list)
    protection: dict | None = None
    sdt_count: int = 0
    fldchar_count: int = 0
    comments: int = 0
    regions: list[dict] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    @property
    def verdict(self) -> str:
        if any(f.level == "BLOCK" for f in self.findings):
            return "KHÔNG ĐẠT"
        if any(f.level == "WARN" for f in self.findings):
            return "ĐẠT CÓ ĐIỀU KIỆN"
        return "ĐẠT"


def para_text(p: ET.Element) -> str:
    return re.sub(r"\s+", " ", "".join(t.text or "" for t in p.iter(q(W, "t")))).strip()


def analyze(path: Path) -> Audit:
    a = Audit(path=path)
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        doc = ET.fromstring(z.read("word/document.xml"))
        settings = z.read("word/settings.xml") if "word/settings.xml" in names else b""
        a.comments = 0
        if "word/comments.xml" in names:
            a.comments = len(list(ET.fromstring(z.read("word/comments.xml")).iter(q(W, "comment"))))

    body = doc.find(q(W, "body"))
    paras = list(body.iter(q(W, "p")))
    a.paragraphs = len(paras)

    ids = [p.get(q(W14, "paraId")) for p in paras]
    valid = [x for x in ids if x and x != "00000000"]
    a.para_ids_ok = len(valid)
    a.para_ids_dup = len(valid) - len(set(valid))

    starts = list(body.iter(q(W, "permStart")))
    a.perm_ids = [e.get(q(W, "id")) or "?" for e in starts]
    a.sdt_count = len(list(body.iter(q(W, "sdt"))))
    # w:fldChar dùng cho MỌI field của Word (số trang, TOC, cross-reference).
    # Legacy Form Field là những field có instruction FORMTEXT/FORMCHECKBOX/FORMDROPDOWN
    # — chỉ đếm những cái đó, nếu không sẽ báo nhầm.
    a.fldchar_count = sum(
        1 for it in body.iter(q(W, "instrText"))
        if re.search(r"\bFORM(TEXT|CHECKBOX|DROPDOWN)\b", it.text or "")
    )

    if starts:
        a.mechanism = "permission_range"
    elif a.sdt_count:
        a.mechanism = "content_control"
    elif a.fldchar_count:
        a.mechanism = "legacy_form_field"

    m = re.search(rb"<w:documentProtection\b([^>]*)>", settings)
    if m:
        attrs = m.group(1).decode("utf-8", "replace")
        a.protection = {
            "edit": (re.search(r'w:edit="([^"]*)"', attrs) or [None, None])[1],
            "enforcement": (re.search(r'w:enforcement="([^"]*)"', attrs) or [None, "0"])[1],
            "has_password": "w:hash=" in attrs,
        }

    # Phân loại vùng mở (rút gọn từ probe-anchors.py)
    a.regions = classify_regions(body)

    check(a)
    return a


def classify_regions(body: ET.Element) -> list[dict]:
    """
    Phân loại vùng mở. Điểm mấu chốt: 'rỗng' phải xét theo các w:r nằm BÊN TRONG
    cặp permStart/permEnd, KHÔNG phải theo text của cả đoạn chứa nó. Một vùng
    không có run nào bên trong thì writer không có w:rPr để kế thừa ⇒ không ghi
    được (TS-04 mục IV.1), dù đoạn chứa nó đầy chữ.
    """
    order: list[tuple[str, str, ET.Element]] = []

    def walk(node: ET.Element, depth: int = 0) -> None:
        for ch in node:
            if ch.tag == q(W, "tbl"):
                walk(ch, depth + 1)
            elif ch.tag == q(W, "p"):
                order.append(("p_begin", str(depth), ch))
                for sub in ch.iter():
                    if sub.tag == q(W, "permStart"):
                        order.append(("start", sub.get(q(W, "id")) or "", sub))
                    elif sub.tag == q(W, "permEnd"):
                        order.append(("end", sub.get(q(W, "id")) or "", sub))
                    elif sub.tag == q(W, "r"):
                        order.append(("run", "", sub))
                order.append(("p_end", str(depth), ch))
            elif ch.tag in (q(W, "permStart"), q(W, "permEnd")):
                order.append(("start" if ch.tag == q(W, "permStart") else "end",
                              ch.get(q(W, "id")) or "", ch))
            else:
                walk(ch, depth)

    walk(body)

    # Text nằm trong lòng từng vùng — dùng để quyết định 'empty'
    inner: dict[str, list[str]] = {}
    live: set[str] = set()
    for kind, val, el in order:
        if kind == "start":
            live.add(val); inner.setdefault(val, [])
        elif kind == "end":
            live.discard(val)
        elif kind == "run" and live:
            txt = "".join(t.text or "" for t in el.iter(q(W, "t")))
            for pid in live:
                inner.setdefault(pid, []).append(txt)

    owned: dict[str, list[ET.Element]] = {}
    depth_of: dict[str, int] = {}
    active: set[str] = set()
    i = 0
    while i < len(order):
        kind, val, el = order[i]
        if kind != "p_begin":
            if kind == "start":
                active.add(val); owned.setdefault(val, []); depth_of.setdefault(val, 0)
            elif kind == "end":
                active.discard(val)
            i += 1
            continue
        lvl = int(val)
        touched = set(active)
        j = i + 1
        while j < len(order) and order[j][0] != "p_end":
            k2, v2, _ = order[j]
            if k2 == "start":
                active.add(v2); owned.setdefault(v2, []); depth_of.setdefault(v2, lvl); touched.add(v2)
            elif k2 == "end":
                active.discard(v2)
            j += 1
        for pid in touched:
            owned.setdefault(pid, []).append(el)
            if depth_of.get(pid, lvl) != lvl:
                depth_of[pid] = -1
        i = j + 1

    out = []
    for pid, ps in owned.items():
        inner_text = re.sub(r"\s+", " ", "".join(inner.get(pid, []))).strip()
        if not inner_text:
            kind = "empty"                       # không có run bên trong ⇒ không ghi được
        elif depth_of.get(pid) == -1:
            kind = "cross_table"
        elif len(ps) <= 1 and len(inner_text) <= ATOMIC_MAX_CHARS:
            kind = "atomic_field"
        else:
            kind = "block_region"
        out.append({"perm_id": pid, "kind": kind, "paras": len(ps),
                    "chars": len(inner_text), "in_table": depth_of.get(pid, 0) > 0,
                    "preview": inner_text[:60]})
    return out


def check(a: Audit) -> None:
    f = a.findings.append

    # ── Cơ chế vùng mở ────────────────────────────────────────────────────
    if a.mechanism == "none":
        f(Finding("BLOCK", "no_open_mechanism",
                  "Không tìm thấy cơ chế vùng mở nào (permStart / Content Control / Form Field)",
                  "Legal đánh dấu vùng cho phép sửa bằng Review → Restrict Editing → "
                  "chọn vùng → Everyone"))
    elif a.mechanism != "permission_range":
        f(Finding("WARN", "mechanism_differs",
                  f"Dùng {a.mechanism}, khác chuẩn permission_range của các template còn lại",
                  "Không sai, nhưng nên thống nhất một cơ chế cho cả bộ template"))

    # ── Restrict Editing ──────────────────────────────────────────────────
    if a.protection is None:
        f(Finding("BLOCK", "no_protection",
                  "KHÔNG có Restrict Editing. Người dùng sửa được toàn bộ hợp đồng bằng Word",
                  "Review → Restrict Editing → tick 'Allow only this type of editing' = "
                  "No changes (Read only) → Yes, Start Enforcing Protection → đặt mật khẩu"))
    else:
        if a.protection["enforcement"] not in ("1", "true"):
            f(Finding("BLOCK", "protection_not_enforced",
                      "Có khai báo documentProtection nhưng enforcement=0 — bảo vệ KHÔNG bật",
                      "Bấm 'Yes, Start Enforcing Protection' và đặt mật khẩu"))
        if a.protection["edit"] != "readOnly":
            f(Finding("WARN", "protection_mode",
                      f"Chế độ bảo vệ là '{a.protection['edit']}', chuẩn là readOnly", ""))
        if not a.protection["has_password"]:
            f(Finding("WARN", "no_password",
                      "Restrict Editing không đặt mật khẩu — người dùng tự gỡ được",
                      "Đặt mật khẩu, Legal giữ (quyết định C1)"))

    # ── Số lượng vùng mở ──────────────────────────────────────────────────
    n = len(a.perm_ids)
    if n == 0:
        f(Finding("BLOCK", "no_open_region", "Không có vùng mở nào", "Đánh dấu các trường cần điền"))
    elif n < MIN_OPEN_REGIONS:
        f(Finding("BLOCK", "too_few_regions",
                  f"Chỉ có {n} vùng mở — không đủ để điền một hợp đồng hoàn chỉnh",
                  "Rà lại toàn văn, đánh dấu mọi chỗ Purchasing cần điền "
                  "(số HĐ, các bên, giá trị, thời hạn, điều khoản thanh toán, phụ lục)"))

    if len(set(a.perm_ids)) != len(a.perm_ids):
        f(Finding("BLOCK", "duplicate_perm_id",
                  "Có permId trùng nhau trong cùng một file",
                  "Xoá hết vùng mở rồi đánh dấu lại từ đầu"))

    # ── Chất lượng vùng mở ────────────────────────────────────────────────
    empties = [r for r in a.regions if r["kind"] == "empty"]
    if len(empties) > MAX_EMPTY_REGIONS:
        f(Finding("WARN", "empty_region",
                  f"{len(empties)} vùng mở RỖNG (id: {', '.join(r['perm_id'] for r in empties)}) — "
                  "hệ thống không ghi vào được vì không có định dạng để kế thừa",
                  "Xoá các vùng mở thừa này, hoặc đặt một chữ placeholder vào trong"))

    cross = [r for r in a.regions if r["kind"] == "cross_table"]
    if cross:
        f(Finding("WARN", "cross_table_region",
                  f"{len(cross)} vùng mở bắc qua ranh giới bảng (id: "
                  f"{', '.join(r['perm_id'] for r in cross)}) — hệ thống chỉ cảnh báo, không tự ghi",
                  "Tách thành các vùng riêng nằm gọn trong hoặc ngoài bảng"))

    # ── Anchor ────────────────────────────────────────────────────────────
    if a.para_ids_ok < a.paragraphs:
        f(Finding("WARN", "paraid_coverage",
                  f"Chỉ {a.para_ids_ok}/{a.paragraphs} đoạn có w14:paraId — "
                  "comment và marker có thể mất neo",
                  "Mở và lưu lại bằng Microsoft Word (Word tự cấp paraId)"))
    if a.para_ids_dup:
        f(Finding("WARN", "paraid_duplicate", f"{a.para_ids_dup} paraId bị trùng", ""))

    if a.comments:
        f(Finding("INFO", "has_comments",
                  f"Template còn {a.comments} comment — sẽ đi theo mọi hợp đồng tạo từ mẫu này",
                  "Xoá comment nội bộ trước khi ban hành"))


# ─────────────────────────────────────────────────────────────────────────────
def print_text(a: Audit) -> None:
    icon = {"ĐẠT": "OK ", "ĐẠT CÓ ĐIỀU KIỆN": "!! ", "KHÔNG ĐẠT": "XX "}[a.verdict]
    print("=" * 78)
    print(f"{icon} {a.path.name}")
    print("=" * 78)
    prot = a.protection
    prot_s = ("KHÔNG CÓ" if prot is None else
              f"{prot['edit']}, enforcement={prot['enforcement']}, "
              f"mật khẩu={'có' if prot['has_password'] else 'KHÔNG'}")
    print(f"  cơ chế        : {a.mechanism}")
    print(f"  bảo vệ        : {prot_s}")
    print(f"  vùng mở       : {len(a.perm_ids)}")
    print(f"  đoạn / paraId : {a.paragraphs} / {a.para_ids_ok} (trùng {a.para_ids_dup})")
    kinds: dict[str, int] = {}
    for r in a.regions:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(f"  phân loại     : {kinds or '—'}")
    print(f"  KẾT LUẬN      : {a.verdict}")
    if a.findings:
        print()
        for fd in sorted(a.findings, key=lambda x: {"BLOCK": 0, "WARN": 1, "INFO": 2}[x.level]):
            print(f"  [{fd.level:5}] {fd.message}")
            if fd.fix:
                print(f"          → {fd.fix}")
    print()


def print_md(audits: list[Audit]) -> None:
    from datetime import date
    print("# Báo cáo kiểm định template hợp đồng khung\n")
    print(f"> Ngày kiểm: {date.today().strftime('%d/%m/%Y')} · "
          f"Công cụ: `scripts/audit-templates.py` · Người thực hiện: Backend/AI Engineer\n")
    print("> Gửi: BA, Legal. Đây là bản chạy CLI của bước kiểm định sẽ chạy tự động "
          "khi Legal đăng ký template trên hệ thống (`TS-04` mục VI.5).\n")

    print("## I. Tổng hợp\n")
    print("| Template | Cơ chế | Bảo vệ | Vùng mở | Kết luận |")
    print("|---|---|---|:---:|---|")
    for a in audits:
        prot = ("**không có**" if a.protection is None
                else ("bật" if a.protection["enforcement"] in ("1", "true") else "**tắt**"))
        v = {"ĐẠT": "✅ ĐẠT", "ĐẠT CÓ ĐIỀU KIỆN": "⚠️ ĐẠT CÓ ĐIỀU KIỆN",
             "KHÔNG ĐẠT": "❌ KHÔNG ĐẠT"}[a.verdict]
        print(f"| {a.path.name} | {a.mechanism} | {prot} | {len(a.perm_ids)} | {v} |")

    ok = [a for a in audits if a.verdict != "KHÔNG ĐẠT"]
    print(f"\n**{len(ok)}/{len(audits)} template dùng được.** "
          f"Hệ thống sẽ CHẶN đăng ký template có lỗi mức BLOCK.\n")

    print("## II. Chi tiết từng template\n")
    for a in audits:
        print(f"### {a.path.name}\n")
        print(f"- Cơ chế vùng mở: `{a.mechanism}` · Content Control: {a.sdt_count} · "
              f"Legacy Form Field: {a.fldchar_count}")
        print(f"- Đoạn: {a.paragraphs} · `w14:paraId` hợp lệ: {a.para_ids_ok} "
              f"(trùng: {a.para_ids_dup})")
        kinds: dict[str, int] = {}
        for r in a.regions:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        print(f"- Vùng mở: {len(a.perm_ids)} — {kinds or 'không có'}")
        print(f"- **Kết luận: {a.verdict}**\n")
        blocks = [f for f in a.findings if f.level == "BLOCK"]
        warns = [f for f in a.findings if f.level == "WARN"]
        infos = [f for f in a.findings if f.level == "INFO"]
        for title, items in (("Lỗi chặn", blocks), ("Cảnh báo", warns), ("Ghi chú", infos)):
            if not items:
                continue
            print(f"**{title}**\n")
            for fd in items:
                print(f"- {fd.message}")
                if fd.fix:
                    print(f"  - *Cách sửa:* {fd.fix}")
            print()

    print("## III. Việc cần làm\n")
    print("| # | Việc | Ai | Template |")
    print("|---|---|---|---|")
    n = 0
    for a in audits:
        for fd in a.findings:
            if fd.level == "BLOCK":
                n += 1
                print(f"| {n} | {fd.fix or fd.message} | Legal | {a.path.name} |")
    print()


def main(argv: list[str]) -> int:
    as_md = "--md" in argv
    args = [x for x in argv if not x.startswith("--")]
    if not args:
        root = Path(__file__).resolve().parent.parent
        args = [str(p) for p in sorted(root.glob("*Template*.docx"))]
        args += [str(p) for p in sorted((root / "frontend/public/samples").glob("*.docx"))]
        # bỏ trùng theo tên file
        seen, uniq = set(), []
        for p in args:
            if Path(p).name not in seen:
                seen.add(Path(p).name); uniq.append(p)
        args = uniq

    audits = [analyze(Path(p)) for p in args]
    if as_md:
        print_md(audits)
    else:
        for a in audits:
            print_text(a)
        bad = sum(1 for a in audits if a.verdict == "KHÔNG ĐẠT")
        print(f"Tổng: {len(audits)} template, {bad} KHÔNG ĐẠT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
