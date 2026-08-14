"""
FX-11..14 — ràng buộc cấu trúc chặn được file đã bị can thiệp.

Blueprint bỏ so khớp nội dung (đúng), nhưng nếu không thay bằng ràng buộc cấu
trúc thì chỉ cần gỡ Restrict Editing là toàn bộ mô hình bảo vệ vùng khoá sụp.
Bộ test này dựng lại đúng các kịch bản đó từ template thật.

Điểm quan trọng nhất không phải là bắt được file hỏng — mà là **không kêu oan
khi người dùng sửa hợp lệ**. Đó là `test_sua_vung_mo_hop_le_khong_bi_bao_loi`.
"""

from __future__ import annotations

import pytest

from app.services.document.allowlist import FieldChange
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.model import Mechanism, RegionKind
from app.services.document.ooxml import DOCUMENT_PART, SETTINGS_PART, DocxPackage, qn
from app.services.document.ooxml_reader import OoxmlReader
from app.services.document.structural_binding import build_binding, verify
from tests.conftest import corpus_path
from tests.format_fidelity.criteria import read

pytestmark = pytest.mark.fidelity


@pytest.fixture
def blob() -> bytes:
    return corpus_path("hddv").read_bytes()


@pytest.fixture
def binding(blob: bytes):
    """Ảnh chụp cấu trúc lúc Legal đăng ký template."""
    return build_binding(read(blob), labels={"1422276696": "Điều khoản Thanh toán"})


def _mutate(blob: bytes, fn) -> bytes:
    pkg = DocxPackage.load(blob)
    fn(pkg)
    return pkg.to_bytes()


def _types(issues) -> list[str]:
    return [i.type for i in issues]


# ─────────────────────────────────────────────────────────────────────────────
# Đường hợp lệ
# ─────────────────────────────────────────────────────────────────────────────
def test_file_goc_khop_chinh_no(blob, binding):
    assert verify(read(blob), binding) == []


def test_sua_vung_mo_hop_le_khong_bi_bao_loi(blob, binding):
    """
    Điền giá trị vào MỌI vùng mở rồi kiểm lại — không được có issue nào.
    Đây là ranh giới giữa "ràng buộc cấu trúc" và "so khớp nội dung" (A6).
    """
    inv = read(blob)
    changes = [
        FieldChange(f.perm_id, "giá trị nghiệp vụ mới")
        for f in inv.fields
        if f.region_kind is RegionKind.ATOMIC_FIELD and f.writable
    ]
    edited = LxmlDocumentEngine().apply_field_changes(blob, changes)

    assert verify(read(edited.document), binding) == []


# ─────────────────────────────────────────────────────────────────────────────
# FX-11 — gỡ Restrict Editing, mọi permStart biến mất
# ─────────────────────────────────────────────────────────────────────────────
def test_fx11_go_het_vung_mo_bi_chan_ngay_o_lop_dau(blob, binding):
    def strip_perms(pkg: DocxPackage) -> None:
        root = pkg.tree(DOCUMENT_PART)
        for tag in ("w:permStart", "w:permEnd"):
            for el in list(root.iter(qn(tag))):
                el.getparent().remove(el)
        pkg.mark_dirty(DOCUMENT_PART)

    issues = verify(read(_mutate(blob, strip_perms)), binding)

    assert _types(issues) == ["mechanism_mismatch"], "phải dừng ngay, không so tiếp"
    assert "Restrict Editing" in (issues[0].diff_preview or "")


# ─────────────────────────────────────────────────────────────────────────────
# FX-12 — thiếu / thừa vùng mở
# ─────────────────────────────────────────────────────────────────────────────
def test_fx12_thieu_mot_vung_mo(blob, binding):
    victim = read(blob).fields[3].perm_id

    def drop_one(pkg: DocxPackage) -> None:
        root = pkg.tree(DOCUMENT_PART)
        for tag in ("w:permStart", "w:permEnd"):
            for el in list(root.iter(qn(tag))):
                if el.get(qn("w:id")) == victim:
                    el.getparent().remove(el)
        pkg.mark_dirty(DOCUMENT_PART)

    issues = verify(read(_mutate(blob, drop_one)), binding)

    assert "count_mismatch" in _types(issues)
    missing = [i for i in issues if i.type == "missing_field"]
    assert [i.field_id for i in missing] == [victim]


def test_fx12_them_vung_mo_la(blob, binding):
    def add_region(pkg: DocxPackage) -> None:
        from lxml import etree

        root = pkg.tree(DOCUMENT_PART)
        body = root.find(qn("w:body"))
        para = next(body.iter(qn("w:p")))
        start = etree.Element(qn("w:permStart"))
        start.set(qn("w:id"), "777777")
        start.set(qn("w:edGrp"), "everyone")
        end = etree.Element(qn("w:permEnd"))
        end.set(qn("w:id"), "777777")
        para.insert(0, start)
        para.append(end)
        pkg.mark_dirty(DOCUMENT_PART)

    issues = verify(read(_mutate(blob, add_region)), binding)

    extra = [i for i in issues if i.type == "unexpected_new_field"]
    assert [i.field_id for i in extra] == ["777777"]


# ─────────────────────────────────────────────────────────────────────────────
# FX-13 — sửa nội dung vùng khoá
# ─────────────────────────────────────────────────────────────────────────────
def test_fx13_sua_doan_khoa_bi_bat_va_noi_ro_truoc_sau(blob, binding):
    inv = read(blob)
    victim = next(p for p in inv.locked_paragraphs if len(p.text) > 40)

    def tamper(pkg: DocxPackage) -> None:
        root = pkg.tree(DOCUMENT_PART)
        for para in root.iter(qn("w:p")):
            if para.get(qn("w14:paraId")) == victim.para_id:
                t = next(para.iter(qn("w:t")))
                t.text = "Hợp Đồng này được điều chỉnh bởi pháp luật Singapore"
                pkg.mark_dirty(DOCUMENT_PART)
                return
        raise AssertionError("không tìm thấy đoạn khoá")

    issues = verify(read(_mutate(blob, tamper)), binding)

    modified = [i for i in issues if i.type == "locked_region_modified"]
    assert modified, "sửa vùng khoá mà không bị phát hiện"
    assert modified[0].field_id == victim.para_id
    assert "Singapore" in (modified[0].diff_preview or "")


def test_fx13_xoa_doan_khoa_bi_bat(blob, binding):
    inv = read(blob)
    victim = next(p for p in inv.locked_paragraphs if len(p.text) > 40)

    def delete_para(pkg: DocxPackage) -> None:
        root = pkg.tree(DOCUMENT_PART)
        for para in root.iter(qn("w:p")):
            if para.get(qn("w14:paraId")) == victim.para_id:
                para.getparent().remove(para)
                break
        pkg.mark_dirty(DOCUMENT_PART)

    issues = verify(read(_mutate(blob, delete_para)), binding)

    assert any(i.type == "locked_region_modified" for i in issues)


# ─────────────────────────────────────────────────────────────────────────────
# FX-14 — giữ nguyên cấu trúc nhưng tắt hiệu lực bảo vệ
# ─────────────────────────────────────────────────────────────────────────────
def test_fx14_tat_enforcement_van_bi_bat(blob, binding):
    """
    Kịch bản tinh vi hơn FX-11: perm range còn nguyên, chỉ `enforcement` bị tắt.
    Cấu trúc trông đúng hoàn toàn, nhưng Word không chặn gì nữa.
    """

    def disable(pkg: DocxPackage) -> None:
        root = pkg.tree(SETTINGS_PART)
        el = root.find(qn("w:documentProtection"))
        el.set(qn("w:enforcement"), "0")
        pkg.mark_dirty(SETTINGS_PART)

    issues = verify(read(_mutate(blob, disable)), binding)

    assert _types(issues) == ["protection_removed"]


def test_fx14_go_han_the_documentprotection(blob, binding):
    def remove(pkg: DocxPackage) -> None:
        root = pkg.tree(SETTINGS_PART)
        el = root.find(qn("w:documentProtection"))
        el.getparent().remove(el)
        pkg.mark_dirty(SETTINGS_PART)

    issues = verify(read(_mutate(blob, remove)), binding)

    assert "protection_removed" in _types(issues)


# ─────────────────────────────────────────────────────────────────────────────
# Binding
# ─────────────────────────────────────────────────────────────────────────────
def test_binding_giu_du_thong_tin_de_bao_loi_cu_the(blob, binding):
    assert binding.mechanism is Mechanism.PERMISSION_RANGE
    assert binding.protection_effective is True
    assert binding.open_region_count == 15
    assert binding.label_of("1422276696") == "Điều khoản Thanh toán"
    assert binding.label_of("1419195680").startswith("vùng mở #")
    assert len(binding.locked_paragraphs) > 50


def test_binding_on_dinh_qua_vong_serialize(blob, binding):
    """Ghi lại document.xml mà không sửa nội dung thì binding không được đổi."""
    def touch(pkg: DocxPackage) -> None:
        pkg.tree(DOCUMENT_PART)
        pkg.mark_dirty(DOCUMENT_PART)

    again = build_binding(read(_mutate(blob, touch)))

    assert again.locked_fingerprint == binding.locked_fingerprint
    assert again.structure_fingerprint == binding.structure_fingerprint


def test_moi_template_that_deu_dung_binding_cua_chinh_no(any_docx):
    """Chạy trên cả 5 file thật — binding phải tự khớp, không có ngoại lệ."""
    name, pkg = any_docx
    inv = OoxmlReader().read(pkg)
    assert verify(inv, build_binding(inv)) == [], name
