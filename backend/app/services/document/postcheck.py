"""
Hậu kiểm — Lớp 2 của ràng buộc C-3.

Lớp 1 (`allowlist`) tin rằng writer làm đúng việc của nó. Lớp này **không tin gì
cả**: nó so sánh gói `.docx` trước và sau khi ghi, che đi phần nội dung nằm
trong các vùng được phép, rồi khẳng định phần còn lại giống hệt nhau.

Nhờ vậy ta *chứng minh* được C-3 thay vì chỉ tuyên bố. Một bug trong
`writer_block` làm xoá nhầm `w:sectPr`, một lần `deepcopy` thiếu, một chỗ ghi
tràn ra ngoài `permEnd` — Lớp 1 đều không thấy, Lớp 2 bắt hết.

Kết quả PHẢI RỖNG. Khác rỗng là sự cố nghiêm trọng: rollback transaction, ghi
audit, đánh thức người trực.
"""

from __future__ import annotations

from lxml.etree import _Element

from app.services.document.errors import AnchorNotFoundError
from app.services.document.model import XmlDiff
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage, qn
from app.services.document.region_locator import locate
from app.services.document.writer_common import find_body

# Nhiễu vô hại của Word — không mang ngữ nghĩa nội dung.
_IGNORED_TAGS = frozenset(
    {
        qn("w:proofErr"),  # dấu soát chính tả
        qn("w:lastRenderedPageBreak"),  # vị trí ngắt trang của lần render trước
    }
)

# `w:rsid*` là dấu vết phiên soạn thảo. Word sinh lại thoải mái, không ảnh hưởng
# nội dung hay định dạng.
_RSID_ATTRS = frozenset(
    qn(f"w:{name}")
    for name in ("rsidR", "rsidRPr", "rsidRDefault", "rsidP", "rsidTr", "rsidDel", "rsidSect")
)

DEFAULT_MAX_DIFFS = 20


def diff_outside(
    before: bytes,
    after: bytes,
    allowed_perm_ids: set[str],
    *,
    allowed_parts: frozenset[str] = frozenset(),
    max_diffs: int = DEFAULT_MAX_DIFFS,
) -> list[XmlDiff]:
    """
    Mọi khác biệt nằm NGOÀI các vùng cho phép.

    `allowed_parts` dành cho các part được sinh thêm có kiểm soát ở vòng sau
    (`comments.xml` khi ghi comment). Ở G2 nó rỗng: chỉ `word/document.xml` được
    phép đổi, và chỉ trong lòng các vùng mở.
    """
    pkg_before = DocxPackage.load(before)
    pkg_after = DocxPackage.load(after)
    out: list[XmlDiff] = []

    _compare_part_sets(pkg_before, pkg_after, allowed_parts, out)
    _compare_raw_parts(pkg_before, pkg_after, allowed_parts, out)

    if len(out) < max_diffs:
        _compare_document(pkg_before, pkg_after, allowed_perm_ids, out, max_diffs)

    return out[:max_diffs]


def assert_no_diff(
    before: bytes,
    after: bytes,
    allowed_perm_ids: set[str],
    **kwargs: object,
) -> None:
    """Dùng ở tầng điều phối: có khác biệt là ném, transaction rollback."""
    from app.services.document.errors import PostcheckFailedError

    diffs = diff_outside(before, after, allowed_perm_ids, **kwargs)  # type: ignore[arg-type]
    if diffs:
        raise PostcheckFailedError(diffs)


# ─────────────────────────────────────────────────────────────────────────────
# Cấp gói
# ─────────────────────────────────────────────────────────────────────────────
def _compare_part_sets(
    before: DocxPackage,
    after: DocxPackage,
    allowed_parts: frozenset[str],
    out: list[XmlDiff],
) -> None:
    names_before = set(before.parts) - allowed_parts
    names_after = set(after.parts) - allowed_parts

    for missing in sorted(names_before - names_after):
        out.append(XmlDiff(part=missing, location="package", detail="part bị xoá khỏi gói"))
    for extra in sorted(names_after - names_before):
        out.append(XmlDiff(part=extra, location="package", detail="part lạ được thêm vào gói"))


def _compare_raw_parts(
    before: DocxPackage,
    after: DocxPackage,
    allowed_parts: frozenset[str],
    out: list[XmlDiff],
) -> None:
    """
    Mọi part trừ `word/document.xml` phải giống BYTE.

    Đây là lý do chính khiến việc giữ format khả thi: `styles.xml`,
    `numbering.xml`, header/footer, `settings.xml` không bao giờ được ghi lại
    nên không thể hỏng.
    """
    shared = (set(before.parts) & set(after.parts)) - allowed_parts - {DOCUMENT_PART}
    for part in sorted(shared):
        if before.raw(part) != after.raw(part):
            out.append(
                XmlDiff(
                    part=part,
                    location="(toàn part)",
                    detail=(
                        f"nội dung đổi: {len(before.raw(part)):,} → "
                        f"{len(after.raw(part)):,} byte"
                    ),
                )
            )


# ─────────────────────────────────────────────────────────────────────────────
# word/document.xml
# ─────────────────────────────────────────────────────────────────────────────
def _compare_document(
    before: DocxPackage,
    after: DocxPackage,
    allowed_perm_ids: set[str],
    out: list[XmlDiff],
    max_diffs: int,
) -> None:
    body_before = find_body(before.tree(DOCUMENT_PART))
    body_after = find_body(after.tree(DOCUMENT_PART))

    _strip_allowed_regions(body_before, allowed_perm_ids, "trước", out)
    _strip_allowed_regions(body_after, allowed_perm_ids, "sau", out)

    _compare_elements(body_before, body_after, "/w:body", out, max_diffs)


def _strip_allowed_regions(
    body: _Element,
    allowed_perm_ids: set[str],
    side: str,
    out: list[XmlDiff],
) -> None:
    """
    Xoá khỏi cây so sánh mọi run nằm trong vùng được phép ghi.

    Làm ở CẢ HAI phía nên nội dung mới cũ đều biến mất — phần còn lại là thứ
    đáng lẽ không được đổi.
    """
    for perm_id in sorted(allowed_perm_ids):
        try:
            segments = locate(body, perm_id)
        except AnchorNotFoundError:
            out.append(
                XmlDiff(
                    part=DOCUMENT_PART,
                    location=f"permId={perm_id}",
                    detail=f"vùng được phép ghi biến mất khỏi bản {side}",
                )
            )
            continue

        for segment in segments:
            for run in segment.runs:
                parent = run.getparent()
                if parent is not None:
                    parent.remove(run)


def _compare_elements(
    a: _Element,
    b: _Element,
    path: str,
    out: list[XmlDiff],
    max_diffs: int,
) -> None:
    """So sánh đệ quy hai cây, bỏ qua nhiễu đã liệt kê tường minh."""
    if len(out) >= max_diffs:
        return

    if a.tag != b.tag:
        out.append(
            XmlDiff(DOCUMENT_PART, path, f"thẻ đổi: {_name(a.tag)} → {_name(b.tag)}")
        )
        return

    attrs_a = _attrs(a)
    attrs_b = _attrs(b)
    if attrs_a != attrs_b:
        for key in sorted(set(attrs_a) | set(attrs_b)):
            if attrs_a.get(key) != attrs_b.get(key):
                out.append(
                    XmlDiff(
                        DOCUMENT_PART,
                        path,
                        f"thuộc tính {_name(key)}: {attrs_a.get(key)!r} → {attrs_b.get(key)!r}",
                    )
                )
                if len(out) >= max_diffs:
                    return

    if _text(a) != _text(b):
        out.append(
            XmlDiff(DOCUMENT_PART, path, f"text đổi: {_text(a)[:60]!r} → {_text(b)[:60]!r}")
        )

    children_a = _children(a)
    children_b = _children(b)
    if len(children_a) != len(children_b):
        out.append(
            XmlDiff(
                DOCUMENT_PART,
                path,
                f"số phần tử con đổi: {len(children_a)} → {len(children_b)}",
            )
        )
        return

    counter: dict[str, int] = {}
    for child_a, child_b in zip(children_a, children_b, strict=True):
        name = _name(child_a.tag)
        counter[name] = counter.get(name, 0) + 1
        _compare_elements(child_a, child_b, f"{path}/{name}[{counter[name]}]", out, max_diffs)
        if len(out) >= max_diffs:
            return


def _children(el: _Element) -> list[_Element]:
    return [c for c in el if isinstance(c.tag, str) and c.tag not in _IGNORED_TAGS]


def _attrs(el: _Element) -> dict[str, str]:
    return {k: v for k, v in el.attrib.items() if k not in _RSID_ATTRS}


def _text(el: _Element) -> str:
    return el.text or ""


def _name(tag: str) -> str:
    """'{http://…/main}permStart' → 'w:permStart'."""
    if not tag.startswith("{"):
        return tag
    uri, _, local = tag[1:].partition("}")
    from app.services.document.ooxml import NS

    for prefix, value in NS.items():
        if value == uri:
            return f"{prefix}:{local}"
    return local
