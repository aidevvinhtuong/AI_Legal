"""
Bộ tiêu chí cứng "giữ format" (TS-04 mục X.1) — dùng lại cho mọi test ghi.

Tiêu chí 1 (Word mở không cảnh báo) và 3 (số trang không đổi) cần Microsoft Word
và LibreOffice nên không tự động hoá ở đây; chúng thuộc bước nghiệm thu thủ công
của PoC-1. Bảy tiêu chí còn lại kiểm được hoàn toàn bằng code và chạy trong CI.
"""

from __future__ import annotations

from app.services.document.model import FieldInventory
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage, qn
from app.services.document.ooxml_reader import OoxmlReader
from app.services.document.postcheck import diff_outside

_COUNTED_TAGS = ("w:p", "w:tbl", "w:tr", "w:tc", "w:sectPr", "w:permStart", "w:permEnd")


def read(blob: bytes) -> FieldInventory:
    return OoxmlReader().read(DocxPackage.load(blob))


def assert_hard_criteria(before: bytes, after: bytes, allowed_perm_ids: set[str]) -> None:
    """Ném AssertionError kèm mô tả cụ thể nếu vi phạm bất kỳ tiêu chí nào."""
    pkg_before = DocxPackage.load(before)
    pkg_after = DocxPackage.load(after)
    inv_before = OoxmlReader().read(pkg_before)
    inv_after = OoxmlReader().read(pkg_after)

    # TC-2 — hậu kiểm rỗng. Tiêu chí bao trùm nhất.
    diffs = diff_outside(before, after, allowed_perm_ids)
    assert not diffs, "diff_outside không rỗng:\n" + "\n".join(
        f"  {d.part} {d.location}: {d.detail}" for d in diffs
    )

    # TC-4, TC-5 — số đoạn, bảng, hàng, ô, sectPr không đổi
    body_before = pkg_before.tree(DOCUMENT_PART).find(qn("w:body"))
    body_after = pkg_after.tree(DOCUMENT_PART).find(qn("w:body"))
    for tag in _COUNTED_TAGS:
        n_before = len(list(body_before.iter(qn(tag))))
        n_after = len(list(body_after.iter(qn(tag))))
        assert n_after == n_before, f"số {tag} đổi: {n_before} → {n_after}"

    # TC-6 — paraId của vùng khoá còn nguyên (điều kiện để comment không mồ côi)
    locked_before = {p.para_id for p in inv_before.locked_paragraphs}
    locked_after = {p.para_id for p in inv_after.locked_paragraphs}
    assert locked_after == locked_before, (
        f"paraId vùng khoá đổi: thiếu {sorted(locked_before - locked_after)}, "
        f"lạ {sorted(locked_after - locked_before)}"
    )

    # TC-7 — mọi part trừ document.xml giống byte
    for part, raw in pkg_before.parts.items():
        if part == DOCUMENT_PART:
            continue
        assert pkg_after.has(part), f"mất part {part}"
        assert pkg_after.raw(part) == raw, f"part {part} bị đổi dù không hề ghi vào"

    # TC-8 — dãy nhãn đánh số điều khoản không đổi
    labels_before = [p.numbering_label for p in inv_before.paragraphs]
    labels_after = [p.numbering_label for p in inv_after.paragraphs]
    assert labels_after == labels_before, "dãy nhãn đánh số điều khoản đổi"

    # TC-9 — comment của bên thứ ba còn nguyên
    assert inv_after.comment_count == inv_before.comment_count, "số comment đổi"

    # Vùng mở phải còn đủ và giữ nguyên phân loại
    assert inv_after.perm_ids == inv_before.perm_ids, "tập vùng mở đổi"
    for pid in inv_before.perm_ids:
        fa = inv_after.field_by_perm_id(pid)
        fb = inv_before.field_by_perm_id(pid)
        assert fa is not None and fb is not None
        if pid not in allowed_perm_ids:
            assert fa.inner_text == fb.inner_text, f"vùng {pid} bị đổi dù không được ghi"


def assert_locked_text_unchanged(before: bytes, after: bytes) -> None:
    """Kiểm trực diện ràng buộc C-3: không một ký tự nào trong vùng khoá đổi."""
    inv_before = read(before)
    inv_after = read(after)
    assert inv_after.locked_fingerprint() == inv_before.locked_fingerprint(), (
        "nội dung vùng khoá đã thay đổi"
    )
