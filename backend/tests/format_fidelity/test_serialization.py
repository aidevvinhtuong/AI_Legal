"""
Kiểm chứng vòng serialize của lxml — de-risk cho G2.

FX-00 (round-trip giống byte) pass một cách hiển nhiên vì `to_bytes()` trả lại
bytes gốc khi không có part nào bẩn. Đó là thiết kế đúng, nhưng nó KHÔNG trả lời
được câu hỏi thật của bước ghi:

    Khi buộc phải serialize lại word/document.xml, lxml có làm mất mát gì không?

Nếu lxml đổi khai báo namespace, nuốt thẻ rỗng, đổi self-closing tag, hay bỏ
`xml:space`, thì mọi writer ở G2 sẽ âm thầm phá format. Test dưới đây ép
serialize rồi so sánh ngữ nghĩa.
"""

from __future__ import annotations

import pytest

from app.services.document.model import normalize
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage, qn
from app.services.document.ooxml_reader import OoxmlReader
from tests.conftest import corpus_path

pytestmark = pytest.mark.fidelity


def _force_reserialize(pkg: DocxPackage) -> DocxPackage:
    """Ép ghi lại document.xml mà KHÔNG thay đổi nội dung gì."""
    pkg.tree(DOCUMENT_PART)
    pkg.mark_dirty(DOCUMENT_PART)
    return DocxPackage.load(pkg.to_bytes())


def test_serialize_lai_khong_doi_noi_dung_van_ban(any_docx):
    name, pkg = any_docx
    before = OoxmlReader().read(pkg)
    after = OoxmlReader().read(_force_reserialize(pkg))

    assert len(after.paragraphs) == len(before.paragraphs), f"{name}: số đoạn đổi"
    for a, b in zip(after.paragraphs, before.paragraphs, strict=True):
        assert a.para_id == b.para_id, f"{name}: paraId đổi — comment sẽ mồ côi"
        assert normalize(a.text) == normalize(b.text), f"{name}: text đoạn {b.ordinal} đổi"


def test_serialize_lai_khong_mat_vung_mo(any_docx):
    name, pkg = any_docx
    before = OoxmlReader().read(pkg)
    after = OoxmlReader().read(_force_reserialize(pkg))

    assert after.perm_ids == before.perm_ids, f"{name}: tập vùng mở đổi"
    for pid in before.perm_ids:
        fa, fb = after.field_by_perm_id(pid), before.field_by_perm_id(pid)
        assert fa is not None and fb is not None
        assert fa.region_kind == fb.region_kind, f"{name}/{pid}: phân loại đổi"
        assert normalize(fa.inner_text) == normalize(fb.inner_text), f"{name}/{pid}: nội dung đổi"


def test_serialize_lai_khong_dung_cac_part_khac(any_docx):
    """
    Chỉ document.xml được ghi lại. styles/numbering/header/footer phải giống BYTE —
    đây là lý do chính khiến việc giữ format khả thi.
    """
    name, pkg = any_docx
    original_parts = dict(pkg.parts)
    after = DocxPackage.load(_force_reserialize(pkg).original)

    for part, raw in original_parts.items():
        if part == DOCUMENT_PART:
            continue
        assert after.raw(part) == raw, f"{name}: part {part} bị đổi dù không hề ghi vào"


def test_serialize_lai_giu_numbering_va_bang(any_docx):
    name, pkg = any_docx
    before = OoxmlReader().read(pkg)
    after = OoxmlReader().read(_force_reserialize(pkg))

    lb_before = [p.numbering_label for p in before.paragraphs]
    lb_after = [p.numbering_label for p in after.paragraphs]
    assert lb_after == lb_before, f"{name}: nhãn đánh số điều khoản đổi"

    body_b = pkg.tree(DOCUMENT_PART).find(qn("w:body"))
    for tag in ("w:tbl", "w:tr", "w:tc", "w:p", "w:sectPr"):
        n_before = len(list(body_b.iter(qn(tag))))
        n_after = len(
            list(
                DocxPackage.load(pkg.original).tree(DOCUMENT_PART).find(qn("w:body")).iter(qn(tag))
            )
        )
        assert n_after == n_before, f"{name}: số {tag} đổi"


def test_serialize_lai_giu_xml_space_preserve():
    """
    `xml:space="preserve"` mà mất là khoảng trắng bị nuốt. Với marker eContract
    (`#ds:id r:… h:100 #` — có khoảng trắng trong cú pháp) thì đó là lỗi chặn.
    """
    pkg = DocxPackage.load(corpus_path("hddv").read_bytes())
    body = pkg.tree(DOCUMENT_PART).find(qn("w:body"))
    before = sum(1 for t in body.iter(qn("w:t")) if t.get(qn("xml:space")) == "preserve")

    after_pkg = _force_reserialize(pkg)
    after_body = after_pkg.tree(DOCUMENT_PART).find(qn("w:body"))
    after = sum(1 for t in after_body.iter(qn("w:t")) if t.get(qn("xml:space")) == "preserve")

    assert before > 0, "file mẫu không có xml:space=preserve — test vô nghĩa"
    assert after == before, "mất thuộc tính xml:space khi serialize lại"


def test_khai_bao_namespace_van_con_sau_khi_ghi_lai():
    """Mất khai báo namespace là Word báo file hỏng."""
    pkg = DocxPackage.load(corpus_path("hddv").read_bytes())
    out = _force_reserialize(pkg)
    xml = out.raw(DOCUMENT_PART)

    assert xml.startswith(b"<?xml"), "thiếu khai báo XML"
    assert b'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' in xml
    assert b'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"' in xml
