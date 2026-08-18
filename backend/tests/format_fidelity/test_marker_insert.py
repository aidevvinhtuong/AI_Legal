"""
Chèn marker ký số vào `.docx` thật — kiểm trên hợp đồng đang lưu hành.

Bài quan trọng nhất ở đây: **bản xuất bản khác bản gốc ĐÚNG ở các đoạn marker,
không hơn**. Chèn marker về mặt kỹ thuật là ghi vào vùng khoá, nên nó chỉ được
tồn tại trên bản sao dùng để trình ký, và phải chứng minh được là không đụng gì
khác — cùng tinh thần với hậu kiểm Lớp 2 của đường ghi trường.
"""

from __future__ import annotations

import pytest

from app.services.document.engine import LxmlDocumentEngine
from app.services.document.errors import MarkerAnchorNotFoundError
from app.services.document.marker import (
    MARKER_RE,
    MarkerPlacement,
    diff_marker_only,
    insert_markers,
    list_anchors,
    marker_text,
)
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage, qn
from tests.conftest import corpus_path

pytestmark = pytest.mark.fidelity

DOCS = ["hddv", "thaco"]


def _inventory(blob: bytes):
    engine = LxmlDocumentEngine()
    return engine.get_field_inventory(engine.parse(blob))


def _placement(para_id: str, index: int = 1, **over) -> MarkerPlacement:
    kwargs = {
        "marker_id": f"ds_p_00{index}_r_001",
        "marker_type": "ds",
        "recipient_ref": f"p_00{index}_r_001",
        "height": 98,
        "para_id": para_id,
        "width_px": 164,
        "align": "center",
    }
    kwargs.update(over)
    return MarkerPlacement(**kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# Anchor
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", DOCS)
def test_moi_doan_deu_neo_duoc_ke_ca_doan_trong(name: str):
    """Đoạn trống trên dòng kẻ ký là chỗ ĐẸP NHẤT để đặt ô ký — không được lọc bỏ."""
    inventory = _inventory(corpus_path(name).read_bytes())
    anchors = list_anchors(inventory)

    assert len(anchors) == len(inventory.paragraphs)
    assert any(a.blank for a in anchors), "phải giữ lại cả đoạn trống"
    assert len({a.para_id for a in anchors}) == len(anchors), "paraId phải duy nhất"


@pytest.mark.parametrize("name", DOCS)
def test_goi_y_tim_dung_khoi_chu_ky(name: str):
    """
    Dò bằng dấu hiệu CẤU TRÚC (đoạn chỉ chứa dòng kẻ `______`), không dò từ khoá
    tiếng Việt — nội dung nghiệp vụ thuộc Legal, không hardcode (bất biến B3).
    """
    anchors = list_anchors(_inventory(corpus_path(name).read_bytes()))
    recommended = [a for a in anchors if a.recommended]

    assert recommended, "không tìm được khối chữ ký nào"
    assert all(a.in_table for a in recommended), "khối chữ ký của hai mẫu thật đều nằm trong bảng"
    # Hai bên ký ⇒ hai cụm gợi ý, mỗi cụm vài đoạn quanh dòng kẻ
    assert 6 <= len(recommended) <= 20


# ─────────────────────────────────────────────────────────────────────────────
# Cú pháp
# ─────────────────────────────────────────────────────────────────────────────
def test_cu_phap_marker_dung_tai_lieu_fpt():
    text = marker_text(_placement("ABCD1234", width_px=160), px_per_space=8.0)

    match = MARKER_RE.match(text)
    assert match, f"sai cú pháp: {text!r}"
    assert match.group(1) == "ds"
    assert match.group(3) == "p_001_r_001"
    assert match.group(4) == "98"
    assert len(match.group(5)) == 20, "bề rộng ô ký = số khoảng trắng giữa #…#"


def test_o_ky_hep_van_con_it_nhat_mot_khoang_trang():
    text = marker_text(_placement("ABCD1234", width_px=1), px_per_space=8.0)
    assert MARKER_RE.match(text)


# ─────────────────────────────────────────────────────────────────────────────
# Chèn
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", DOCS)
def test_chen_marker_khong_dung_gi_ngoai_doan_marker(name: str):
    """Hậu kiểm: bản xuất bản = bản gốc + đúng các đoạn marker."""
    blob = corpus_path(name).read_bytes()
    recommended = [a for a in list_anchors(_inventory(blob)) if a.recommended]

    result = insert_markers(
        blob,
        [
            _placement(recommended[0].para_id, 1),
            _placement(recommended[-1].para_id, 2, width_px=220, align="right"),
        ],
    )

    assert (
        diff_marker_only(before=blob, after=result.document, marker_texts=list(result.texts)) == []
    )


@pytest.mark.parametrize("name", DOCS)
def test_kiem_ke_vung_mo_khong_doi_sau_khi_chen(name: str):
    """Chèn marker không được làm mất hay sinh thêm vùng mở nào."""
    blob = corpus_path(name).read_bytes()
    before = _inventory(blob)
    anchor = next(a for a in list_anchors(before) if a.recommended)

    after = _inventory(insert_markers(blob, [_placement(anchor.para_id)]).document)

    assert set(after.perm_ids) == set(before.perm_ids)
    assert after.counts_by_kind() == before.counts_by_kind()
    assert after.structure_fingerprint() == before.structure_fingerprint()
    assert after.protection == before.protection, "Restrict Editing phải còn nguyên"


@pytest.mark.parametrize("name", DOCS)
def test_paraid_cua_moi_doan_cu_deu_song_sot(name: str):
    """Mất `paraId` là mất neo của cả comment lẫn marker ở các vòng sau."""
    blob = corpus_path(name).read_bytes()
    before = {p.para_id for p in _inventory(blob).paragraphs}
    anchor = next(a for a in list_anchors(_inventory(blob)) if a.recommended)

    after = {
        p.para_id
        for p in _inventory(insert_markers(blob, [_placement(anchor.para_id)]).document).paragraphs
    }

    assert before <= after


def test_marker_la_muc_trang_va_ke_thua_dinh_dang():
    """Ràng buộc C-8: mực trắng. Và cỡ chữ phải theo văn bản quanh nó."""
    blob = corpus_path("thaco").read_bytes()
    anchor = next(a for a in list_anchors(_inventory(blob)) if a.recommended)
    result = insert_markers(blob, [_placement(anchor.para_id)])

    body = DocxPackage.load(result.document).tree(DOCUMENT_PART).find(qn("w:body"))
    runs = [
        r
        for r in body.iter(qn("w:r"))
        if (t := r.find(qn("w:t"))) is not None and (t.text or "").startswith("#ds:")
    ]
    assert len(runs) == 1

    rpr = runs[0].find(qn("w:rPr"))
    assert rpr.find(qn("w:color")).get(qn("w:val")) == "FFFFFF"
    assert rpr.find(qn("w:rFonts")) is not None or rpr.find(qn("w:sz")) is not None, (
        "phải kế thừa định dạng của đoạn neo, không tự chế"
    )

    node = runs[0].find(qn("w:t"))
    assert node.get(qn("xml:space")) == "preserve", "thiếu là mất khoảng trắng ⇒ mất bề rộng ô ký"


def test_marker_khong_bi_word_danh_so_theo_dieu_khoan():
    """
    Bẫy F5: copy `w:pPr` của đoạn neo sẽ kéo theo `w:numPr`, và Word đánh số
    marker như một khoản mới — làm lệch số thứ tự của mọi điều khoản phía sau.
    """
    blob = corpus_path("thaco").read_bytes()
    anchor = next(a for a in list_anchors(_inventory(blob)) if a.recommended)
    result = insert_markers(blob, [_placement(anchor.para_id)])

    body = DocxPackage.load(result.document).tree(DOCUMENT_PART).find(qn("w:body"))
    marker_para = next(
        p
        for p in body.iter(qn("w:p"))
        if any((t.text or "").startswith("#ds:") for t in p.iter(qn("w:t")))
    )
    ppr = marker_para.find(qn("w:pPr"))
    assert ppr.find(qn("w:numPr")) is None
    assert ppr.find(qn("w:pStyle")) is None


def test_neo_khong_ton_tai_thi_nem_chu_khong_doan_bua():
    """Đoán sang đoạn khác nghĩa là chữ ký nằm sai chỗ trong hợp đồng thật."""
    blob = corpus_path("thaco").read_bytes()
    with pytest.raises(MarkerAnchorNotFoundError):
        insert_markers(blob, [_placement("KHONGCOTHAT")])


def test_khong_co_marker_thi_tra_lai_dung_bytes_goc():
    blob = corpus_path("thaco").read_bytes()
    assert insert_markers(blob, []).document is blob
