"""
G1 — kiểm chứng tầng đọc trên .docx THẬT.

Con số kỳ vọng lấy từ khảo sát thực tế bằng scripts/inspect-template.py và
scripts/probe-anchors.py (xem TS-04 mục I). Test này là lưới an toàn: nếu ai đó
sửa reader làm lệch kết quả, nó đỏ ngay.
"""

from __future__ import annotations

import pytest

from app.services.document.model import Mechanism, RegionKind
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage
from app.services.document.ooxml_reader import OoxmlReader
from tests.conftest import corpus_path

pytestmark = pytest.mark.fidelity


# ─────────────────────────────────────────────────────────────────────────────
# FX-00 — CỔNG CHẶN. Parse rồi export mà không sửa gì phải giống byte.
# Fail cái này thì mọi test phía sau không đáng tin.
# ─────────────────────────────────────────────────────────────────────────────
def test_fx00_round_trip_giong_byte(any_docx):
    name, pkg = any_docx
    before = corpus_path(name).read_bytes()

    pkg.tree(DOCUMENT_PART)  # ép parse
    OoxmlReader().read(pkg)  # ép đọc toàn bộ
    after = pkg.to_bytes()

    assert after == before, f"{name}: round-trip làm đổi file dù không sửa gì"


def test_fx00_khong_danh_dau_ban_khi_chi_doc(any_docx):
    _, pkg = any_docx
    OoxmlReader().read(pkg)
    assert pkg.dirty_parts == frozenset(), "chỉ đọc mà có part bị đánh dấu bẩn"


# ─────────────────────────────────────────────────────────────────────────────
# Cơ chế vùng mở — giả định GĐ-1
# ─────────────────────────────────────────────────────────────────────────────
def test_moi_template_deu_dung_range_permission(any_docx):
    name, pkg = any_docx
    inv = OoxmlReader().read(pkg)
    assert inv.mechanism is Mechanism.PERMISSION_RANGE, name
    assert inv.sdt_count == 0, f"{name}: không kỳ vọng có Content Control"
    assert inv.legacy_form_field_count == 0, f"{name}: không kỳ vọng có Legacy Form Field"


def test_paraid_phu_100_phan_tram_va_khong_trung(any_docx):
    """`w14:paraId` là anchor bền cho comment và marker (QĐ-4)."""
    name, pkg = any_docx
    inv = OoxmlReader().read(pkg)
    ids = [p.para_id for p in inv.paragraphs]
    assert all(not i.startswith("__idx") for i in ids), f"{name}: có đoạn thiếu paraId"
    assert len(set(ids)) == len(ids), f"{name}: paraId bị trùng"


def test_perm_id_duy_nhat(any_docx):
    name, pkg = any_docx
    inv = OoxmlReader().read(pkg)
    ids = list(inv.perm_ids)
    assert len(set(ids)) == len(ids), f"{name}: perm_id trùng nhau"


# ─────────────────────────────────────────────────────────────────────────────
# Template HDDV — bản đạt chuẩn, dùng làm chuẩn đối chiếu
# ─────────────────────────────────────────────────────────────────────────────
def test_hddv_dung_15_vung_va_197_doan(hddv: DocxPackage):
    inv = OoxmlReader().read(hddv)
    assert len(inv.fields) == 15
    assert len(inv.paragraphs) == 197


def test_hddv_phan_loai_vung(hddv: DocxPackage):
    """1 vùng rỗng + 1 vùng bắc qua bảng — khớp báo cáo kiểm định."""
    inv = OoxmlReader().read(hddv)
    counts = inv.counts_by_kind()
    assert counts.get("empty") == 1, counts
    assert counts.get("cross_table") == 1, counts
    assert counts.get("atomic_field", 0) + counts.get("block_region", 0) == 13, counts


def test_hddv_vung_rong_va_bac_bang_khong_ghi_duoc(hddv: DocxPackage):
    """Hai loại này phải nằm NGOÀI allow-list."""
    inv = OoxmlReader().read(hddv)
    for f in inv.fields:
        if f.region_kind in (RegionKind.EMPTY, RegionKind.CROSS_TABLE):
            assert not f.writable, f"{f.perm_id} ({f.region_kind}) không được phép ghi"
    assert "1833902955" not in inv.writable_perm_ids  # vùng rỗng
    assert "1984977351" not in inv.writable_perm_ids  # vùng bắc qua bảng


def test_hddv_bao_ve_co_hieu_luc(hddv: DocxPackage):
    inv = OoxmlReader().read(hddv)
    assert inv.protection is not None
    assert inv.protection.is_effective, "HDDV phải có Restrict Editing đang bật"
    assert inv.protection.has_password


def test_hddv_giai_duoc_so_dieu_khoan(hddv: DocxPackage):
    """
    PH-6: số điều khoản do numbering.xml sinh, KHÔNG nằm trong text.
    Không resolve được thì AI sẽ trích dẫn sai vị trí.
    """
    inv = OoxmlReader().read(hddv)
    labels = [p.numbering_label for p in inv.paragraphs if p.numbering_label]
    assert labels, "không resolve được nhãn đánh số nào"
    assert any(lb.startswith("Điều") for lb in labels), labels[:20]
    # Không nhãn nào được xuất hiện trong text thuần của chính đoạn đó
    for p in inv.paragraphs:
        if p.numbering_label and p.numbering_label.startswith("Điều"):
            assert p.numbering_label not in p.text


def test_hddv_vung_thanh_toan_la_block_nhieu_doan(hddv: DocxPackage):
    """
    Vùng 1422276696 là TOÀN BỘ điều khoản Thanh toán: 13 đoạn, ~2100 ký tự.
    Đây là bằng chứng tiền đề "Phase 1 chỉ là điền field" chỉ đúng một phần.
    """
    inv = OoxmlReader().read(hddv)
    f = inv.field_by_perm_id("1422276696")
    assert f is not None
    assert f.region_kind is RegionKind.BLOCK_REGION
    assert f.para_count > 5
    assert f.char_len > 1500
    assert "Thanh toán" in f.inner_text or "thanh toán" in f.inner_text


# ─────────────────────────────────────────────────────────────────────────────
# Hợp đồng THACO — ca "một đoạn chứa hai vùng mở" (PH-5)
# ─────────────────────────────────────────────────────────────────────────────
def test_thaco_dung_16_vung_va_230_doan(thaco: DocxPackage):
    inv = OoxmlReader().read(thaco)
    assert len(inv.fields) == 16
    assert len(inv.paragraphs) == 230


def test_thaco_mot_doan_chua_hai_vung_mo(thaco: DocxPackage):
    """
    Đoạn 66 chứa cả vùng "30" (1419390840) lẫn "ký hợp đồng" (482367384).
    Vì vậy khoá định danh field phải là perm_id, paraId một mình KHÔNG đủ.
    """
    inv = OoxmlReader().read(thaco)
    a = inv.field_by_perm_id("1419390840")
    b = inv.field_by_perm_id("482367384")
    assert a is not None and b is not None
    assert set(a.para_ids) & set(b.para_ids), "hai vùng này phải dùng chung một đoạn"

    shared = (set(a.para_ids) & set(b.para_ids)).pop()
    para = inv.paragraph_by_id(shared)
    assert para is not None
    assert len(para.perm_ids) >= 2, para.perm_ids


def test_thaco_inline_field_khong_bi_doc_thanh_rong(thaco: DocxPackage):
    """
    Lỗi kinh điển: quy text cả đoạn cho vùng, hoặc bỏ sót permStart nằm trong
    lòng đoạn — cả hai đều khiến inline field bị đếm nhầm là rỗng.
    """
    inv = OoxmlReader().read(thaco)
    f = inv.field_by_perm_id("1419390840")
    assert f is not None
    assert f.inner_text.strip() == "30", repr(f.inner_text)
    assert f.region_kind is RegionKind.ATOMIC_FIELD


def test_thaco_giu_comment_cua_ben_thu_ba(thaco: DocxPackage):
    """PH-7: file đã mang sẵn 3 comment — PA-B sau này phải merge, không ghi đè."""
    inv = OoxmlReader().read(thaco)
    assert inv.comment_count == 3


# ─────────────────────────────────────────────────────────────────────────────
# Ba template lỗi — reader phải phản ánh đúng hiện trạng, không "chữa cháy"
# ─────────────────────────────────────────────────────────────────────────────
def test_ocean_khai_bao_bao_ve_nhung_khong_bat():
    pkg = DocxPackage.load(corpus_path("hdvt_ocean").read_bytes())
    inv = OoxmlReader().read(pkg)
    assert inv.protection is not None
    assert inv.protection.edit == "readOnly"
    assert not inv.protection.enforcement, "template này enforcement=0"
    assert not inv.protection.is_effective


@pytest.mark.parametrize("name", ["hdvt_fcl", "hdvt_dtd"])
def test_hai_template_thieu_bao_ve_va_chi_co_mot_vung(name: str):
    pkg = DocxPackage.load(corpus_path(name).read_bytes())
    inv = OoxmlReader().read(pkg)
    assert inv.protection is None, "hai template này không có Restrict Editing"
    assert len(inv.fields) == 1, "chỉ có đúng 1 vùng mở — không điền nổi hợp đồng"


# ─────────────────────────────────────────────────────────────────────────────
# An toàn
# ─────────────────────────────────────────────────────────────────────────────
def test_tu_choi_file_khong_phai_docx():
    from app.services.document.ooxml import DocxError

    with pytest.raises(DocxError, match="chữ ký ZIP"):
        DocxPackage.load(b"day khong phai file docx")


def test_chan_gia_nen_qua_lon(hddv: DocxPackage):
    from app.services.document.ooxml import UnsafeDocxError

    raw = corpus_path("hddv").read_bytes()
    with pytest.raises(UnsafeDocxError, match="vượt ngưỡng"):
        DocxPackage.load(raw, max_unzip_bytes=1024)
    with pytest.raises(UnsafeDocxError, match="vượt ngưỡng"):
        DocxPackage.load(raw, max_entries=2)
