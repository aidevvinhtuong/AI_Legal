"""
G2 — kiểm chứng tầng GHI trên .docx THẬT.

Mọi test ở đây đi qua `LxmlDocumentEngine.apply_field_changes`, tức là luôn có
cả hai lớp chặn chạy. Không test writer trần: đó không phải đường mà production
dùng, test nó sẽ cho cảm giác an toàn sai.
"""

from __future__ import annotations

import pytest

from app.services.document.allowlist import FieldChange
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.errors import (
    EmptyParagraphNotWritableError,
    NotAtomicRegionError,
    ParagraphCountMismatchError,
)
from app.services.document.model import RegionKind
from app.services.document.ooxml import DocxPackage
from app.services.document.ooxml_reader import OoxmlReader
from app.services.document.region_locator import locate
from app.services.document.writer_common import find_body
from app.services.document.writer_inline import write_inline
from tests.conftest import corpus_path
from tests.format_fidelity.criteria import (
    assert_hard_criteria,
    assert_locked_text_unchanged,
    read,
)

pytestmark = pytest.mark.fidelity


@pytest.fixture
def engine() -> LxmlDocumentEngine:
    return LxmlDocumentEngine()


def _blob(name: str) -> bytes:
    return corpus_path(name).read_bytes()


def _fields(blob: bytes, kind: RegionKind):
    return [f for f in read(blob).fields if f.region_kind is kind and f.writable]


# ─────────────────────────────────────────────────────────────────────────────
# FX-02 — ghi vùng atomic
# ─────────────────────────────────────────────────────────────────────────────
def test_fx02_ghi_tung_atomic_field_giu_dung_format(engine):
    """Ghi lần lượt từng vùng atomic của HDDV, mỗi lần kiểm đủ bộ tiêu chí cứng."""
    blob = _blob("hddv")
    atomic = _fields(blob, RegionKind.ATOMIC_FIELD)
    assert len(atomic) == 8, "template HDDV kỳ vọng 8 vùng atomic ghi được"

    for field in atomic:
        value = f"GIÁ TRỊ MỚI {field.perm_id}"
        result = engine.apply_field_changes(blob, [FieldChange(field.perm_id, value)])

        assert result.changed and not result.rejected
        assert_hard_criteria(blob, result.document, {field.perm_id})
        assert_locked_text_unchanged(blob, result.document)

        after = read(result.document).field_by_perm_id(field.perm_id)
        assert after is not None and after.inner_text == value


def test_fx02_ghi_tat_ca_atomic_cung_luc(engine):
    blob = _blob("hddv")
    atomic = _fields(blob, RegionKind.ATOMIC_FIELD)
    changes = [FieldChange(f.perm_id, f"[{f.ordinal}]") for f in atomic]

    result = engine.apply_field_changes(blob, changes)

    assert len(result.applied) == len(atomic)
    assert_hard_criteria(blob, result.document, {c.perm_id for c in changes})
    for change in changes:
        after = read(result.document).field_by_perm_id(change.perm_id)
        assert after is not None and after.inner_text == change.value


def test_fx02_giu_dinh_dang_cua_run_dau_tien(engine):
    """`w:rPr` phải được kế thừa nguyên vẹn, không dựng lại."""
    blob = _blob("hddv")
    field = _fields(blob, RegionKind.ATOMIC_FIELD)[0]

    result = engine.apply_field_changes(blob, [FieldChange(field.perm_id, "abc")])

    assert result.applied[0].rpr_preserved, "mất w:rPr — chữ sẽ lệch font so với xung quanh"


def test_fx02_giu_khoang_trang_dau_cuoi(engine):
    """Thiếu `xml:space=preserve` là mất khoảng trắng — hỏng cả cú pháp marker."""
    blob = _blob("hddv")
    field = _fields(blob, RegionKind.ATOMIC_FIELD)[0]

    result = engine.apply_field_changes(blob, [FieldChange(field.perm_id, "  x  ")])

    after = read(result.document).field_by_perm_id(field.perm_id)
    assert after is not None and after.inner_text == "  x  "


# ─────────────────────────────────────────────────────────────────────────────
# FX-03 — ghi vùng block
# ─────────────────────────────────────────────────────────────────────────────
def test_fx03_ghi_tung_block_region_giu_dung_so_doan(engine):
    blob = _blob("hddv")
    blocks = _fields(blob, RegionKind.BLOCK_REGION)
    assert len(blocks) == 5, "template HDDV kỳ vọng 5 vùng block"

    for field in blocks:
        segments = _segments(blob, field.perm_id)
        # Đoạn không có run bên trong vùng chỉ nhận chuỗi rỗng
        values = [f"đoạn {i}" if seg.writable else "" for i, seg in enumerate(segments)]

        result = engine.apply_field_changes(blob, [FieldChange(field.perm_id, values)])

        assert result.changed and not result.rejected, field.perm_id
        assert_hard_criteria(blob, result.document, {field.perm_id})
        assert_locked_text_unchanged(blob, result.document)


def test_fx03_sai_so_doan_bi_chan_o_lop_1(engine):
    blob = _blob("hddv")
    field = _fields(blob, RegionKind.BLOCK_REGION)[0]

    result = engine.apply_field_changes(blob, [FieldChange(field.perm_id, ["chỉ một đoạn"])])

    assert not result.changed
    assert result.document == blob, "file phải nguyên vẹn khi mọi thay đổi bị từ chối"
    assert [r.reason for r in result.rejected] == ["paragraph_count_mismatch"]


def test_fx03_writer_block_van_tu_bao_ve_khi_bi_goi_thang():
    """Gọi tắt qua Lớp 1 thì writer phải tự chặn — phòng thủ theo chiều sâu."""
    pkg = DocxPackage.load(_blob("hddv"))
    inv = OoxmlReader().read(pkg)
    field = next(f for f in inv.fields if f.region_kind is RegionKind.BLOCK_REGION)
    body = find_body(pkg.tree("word/document.xml"))

    from app.services.document.writer_block import write_block

    with pytest.raises(ParagraphCountMismatchError):
        write_block(body, field.perm_id, ["một đoạn"])


def test_fx03_doan_trong_khong_nhan_noi_dung():
    """Bỏ qua im lặng thì người dùng mất chữ mà không biết — phải ném."""
    pkg = DocxPackage.load(_blob("hddv"))
    inv = OoxmlReader().read(pkg)
    body = find_body(pkg.tree("word/document.xml"))

    from app.services.document.writer_block import write_block

    target = None
    for field in inv.fields:
        if field.region_kind is not RegionKind.BLOCK_REGION:
            continue
        segments = locate(body, field.perm_id)
        if any(not s.writable for s in segments):
            target = (field.perm_id, segments)
            break

    assert target is not None, "template HDDV kỳ vọng có vùng block chứa đoạn trống"
    perm_id, segments = target
    values = ["nội dung" for _ in segments]

    with pytest.raises(EmptyParagraphNotWritableError):
        write_block(body, perm_id, values)


# ─────────────────────────────────────────────────────────────────────────────
# FX-07 — một đoạn chứa HAI vùng mở (hợp đồng THACO, đoạn 65)
# ─────────────────────────────────────────────────────────────────────────────
def test_fx07_sua_mot_vung_khong_dung_vung_kia_trong_cung_doan(engine):
    """
    "Bên Bán giao hàng … trong vòng [30] ngày kể từ ngày [ký hợp đồng]."

    Khung câu do Legal khoá, hai giá trị được mở. Đây là ca chứng minh writer làm
    việc ở cấp `w:r` chứ không phải cấp `w:p`.
    """
    blob = _blob("thaco")
    inv = read(blob)
    para = next(p for p in inv.paragraphs if len(p.perm_ids) > 1)
    first, second = para.perm_ids[0], para.perm_ids[1]
    before_second = inv.field_by_perm_id(second).inner_text

    result = engine.apply_field_changes(blob, [FieldChange(first, "45")])

    assert_hard_criteria(blob, result.document, {first})
    after = read(result.document)
    assert after.field_by_perm_id(first).inner_text == "45"
    assert after.field_by_perm_id(second).inner_text == before_second, (
        "ghi vùng này làm hỏng vùng kia trong cùng đoạn"
    )

    text = after.paragraph_by_id(para.para_id).text
    assert "Bên Bán giao hàng" in text and "ngày kể từ ngày" in text, (
        "phần khoá của câu bị mất"
    )


def test_fx07_writer_inline_tu_choi_vung_nhieu_doan():
    pkg = DocxPackage.load(_blob("hddv"))
    inv = OoxmlReader().read(pkg)
    body = find_body(pkg.tree("word/document.xml"))
    multi = next(f for f in inv.fields if f.para_count > 1)

    with pytest.raises(NotAtomicRegionError):
        write_inline(body, multi.perm_id, "x")


# ─────────────────────────────────────────────────────────────────────────────
# Ghi lặp lại — bản ghi lần 2 phải ổn định
# ─────────────────────────────────────────────────────────────────────────────
def test_ghi_hai_lan_lien_tiep_van_giu_format(engine):
    blob = _blob("hddv")
    field = _fields(blob, RegionKind.ATOMIC_FIELD)[0]

    once = engine.apply_field_changes(blob, [FieldChange(field.perm_id, "lần 1")])
    twice = engine.apply_field_changes(once.document, [FieldChange(field.perm_id, "lần 2")])

    assert_hard_criteria(once.document, twice.document, {field.perm_id})
    assert read(twice.document).field_by_perm_id(field.perm_id).inner_text == "lần 2"


def _segments(blob: bytes, perm_id: str):
    pkg = DocxPackage.load(blob)
    return locate(find_body(pkg.tree("word/document.xml")), perm_id)
