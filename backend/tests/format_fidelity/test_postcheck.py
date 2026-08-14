"""
SEC-01 và FX-15 — hai lớp chặn của ràng buộc C-3.

    SEC-01: input độc hại (đòi ghi vào vùng khoá) bị Lớp 1 từ chối.
    FX-15:  bug của chính chúng ta (writer ghi tràn ra ngoài) bị Lớp 2 bắt.

Hai kịch bản này là điều kiện tồn tại của dự án. Nếu một trong hai đỏ thì không
có lý do gì để đưa hệ thống ra pilot.
"""

from __future__ import annotations

import pytest
from lxml import etree

from app.services.document.allowlist import AllowList, FieldChange
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.errors import LockViolationError, PostcheckFailedError
from app.services.document.model import RegionKind
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage, qn
from app.services.document.ooxml_reader import OoxmlReader
from app.services.document.postcheck import assert_no_diff, diff_outside
from app.services.document.region_locator import locate
from app.services.document.writer_common import find_body, rewrite_segment
from tests.conftest import corpus_path
from tests.format_fidelity.criteria import read

pytestmark = pytest.mark.fidelity


@pytest.fixture
def engine() -> LxmlDocumentEngine:
    return LxmlDocumentEngine()


@pytest.fixture
def blob() -> bytes:
    return corpus_path("hddv").read_bytes()


# ─────────────────────────────────────────────────────────────────────────────
# SEC-01 — Lớp 1 chặn input độc hại
# ─────────────────────────────────────────────────────────────────────────────
def test_sec01_ghi_vao_perm_id_khong_ton_tai_bi_tu_choi(engine, blob):
    """Trường hợp nguy hiểm nhất: id bịa ra, hoặc id của vùng khoá."""
    result = engine.apply_field_changes(blob, [FieldChange("999999999", "điều khoản mới")])

    assert not result.changed
    assert result.document == blob, "file bị đụng dù yêu cầu đã bị từ chối"
    assert [r.reason for r in result.rejected] == ["not_in_allowlist"]


def test_sec01_ghi_vao_vung_rong_bi_tu_choi(engine, blob):
    empty = next(f for f in read(blob).fields if f.region_kind is RegionKind.EMPTY)

    result = engine.apply_field_changes(blob, [FieldChange(empty.perm_id, "x")])

    assert not result.changed
    assert [r.reason for r in result.rejected] == ["empty_region_unsupported"]


def test_sec01_ghi_vao_vung_bac_qua_bang_bi_tu_choi(engine, blob):
    """Van an toàn `allow_cross_table_write` mặc định tắt (QĐ-3)."""
    cross = next(f for f in read(blob).fields if f.region_kind is RegionKind.CROSS_TABLE)

    result = engine.apply_field_changes(blob, [FieldChange(cross.perm_id, ["x"])])

    assert not result.changed
    assert [r.reason for r in result.rejected] == ["cross_table_write_disabled"]


def test_sec01_mot_yeu_cau_ban_khong_lam_hong_ca_lo(engine, blob):
    """Yêu cầu hợp lệ vẫn chạy, yêu cầu bẩn bị loại và ghi audit riêng."""
    good = next(f for f in read(blob).fields if f.region_kind is RegionKind.ATOMIC_FIELD)

    result = engine.apply_field_changes(
        blob,
        [FieldChange(good.perm_id, "hợp lệ"), FieldChange("111111111", "độc hại")],
    )

    assert [r.perm_id for r in result.applied] == [good.perm_id]
    assert [r.reason for r in result.rejected] == ["not_in_allowlist"]
    assert read(result.document).locked_fingerprint() == read(blob).locked_fingerprint()


def test_sec01_chot_cuoi_cung_neu_ai_do_quen_loc(blob):
    """
    `_write_one` tự kiểm lại allow-list. Đây là phòng thủ cuối: nếu sau này có
    đường gọi mới quên chạy Lớp 1 thì vẫn không ghi được vào vùng khoá.
    """
    pkg = DocxPackage.load(blob)
    inv = OoxmlReader().read(pkg)
    body = find_body(pkg.tree(DOCUMENT_PART))
    empty = next(f for f in inv.fields if not f.writable)

    with pytest.raises(LockViolationError):
        LxmlDocumentEngine._write_one(body, inv, FieldChange(empty.perm_id, "x"))


def test_sec01_ky_tu_dieu_khien_bi_chan_truoc_khi_toi_writer(engine, blob):
    """Ký tự XML không hợp lệ lọt xuống lxml sẽ ném giữa vòng ghi, cây đã sửa dở."""
    good = next(f for f in read(blob).fields if f.region_kind is RegionKind.ATOMIC_FIELD)

    result = engine.apply_field_changes(blob, [FieldChange(good.perm_id, "xin\x00chào")])

    assert not result.changed
    assert [r.reason for r in result.rejected] == ["illegal_characters"]


def test_allowlist_chi_chua_dung_cac_vung_ghi_duoc(blob):
    inv = read(blob)
    allow = AllowList(inv.fields)

    assert allow.writable_perm_ids == inv.writable_perm_ids
    assert len(allow.writable_perm_ids) == 13, "HDDV kỳ vọng 13/15 vùng ghi được"
    for f in inv.fields:
        assert allow.allows(f.perm_id) is f.writable


# ─────────────────────────────────────────────────────────────────────────────
# FX-15 — Lớp 2 bắt bug của chính chúng ta
# ─────────────────────────────────────────────────────────────────────────────
def _sabotage(blob: bytes, mutate) -> tuple[bytes, str]:
    """Ghi hợp lệ vào một vùng atomic, đồng thời phá hoại theo `mutate`."""
    pkg = DocxPackage.load(blob)
    inv = OoxmlReader().read(pkg)
    body = find_body(pkg.tree(DOCUMENT_PART))
    target = next(f for f in inv.fields if f.region_kind is RegionKind.ATOMIC_FIELD)

    rewrite_segment(locate(body, target.perm_id)[0], "giá trị hợp lệ")
    mutate(body, inv)

    pkg.mark_dirty(DOCUMENT_PART)
    return pkg.to_bytes(), target.perm_id


def test_fx15_writer_sua_lan_doan_khoa_bi_bat(blob):
    """Kịch bản bug điển hình: định vị lệch, ghi tràn sang đoạn bên cạnh."""

    def mutate(body, inv):
        locked_id = inv.locked_paragraphs[5].para_id
        for para in body.iter(qn("w:p")):
            if para.get(qn("w14:paraId")) == locked_id:
                t = next(para.iter(qn("w:t")))
                t.text = "ĐIỀU KHOẢN ĐÃ BỊ SỬA TRỘM"
                return
        raise AssertionError("không tìm thấy đoạn khoá để phá hoại")

    after, allowed = _sabotage(blob, mutate)
    diffs = diff_outside(blob, after, {allowed})

    assert diffs, "hậu kiểm KHÔNG bắt được thay đổi trong vùng khoá"
    assert any("text đổi" in d.detail for d in diffs)


def test_fx15_writer_xoa_nham_sectpr_bi_bat(blob):
    """`w:sectPr` mất là khổ giấy, lề, header/footer đi theo."""

    def mutate(body, inv):
        sect = next(body.iter(qn("w:sectPr")))
        sect.getparent().remove(sect)

    after, allowed = _sabotage(blob, mutate)
    diffs = diff_outside(blob, after, {allowed})

    assert diffs, "hậu kiểm KHÔNG bắt được việc mất w:sectPr"


def test_fx15_writer_xoa_nham_ca_doan_bi_bat(blob):
    def mutate(body, inv):
        para = list(body.iter(qn("w:p")))[-3]
        para.getparent().remove(para)

    after, allowed = _sabotage(blob, mutate)
    diffs = diff_outside(blob, after, {allowed})

    assert diffs, "hậu kiểm KHÔNG bắt được việc xoá cả một đoạn"


def test_fx15_writer_lam_mat_perm_end_bi_bat(blob):
    """Mất `permEnd` là vùng mở nuốt phần còn lại của tài liệu."""

    def mutate(body, inv):
        end = next(body.iter(qn("w:permEnd")))
        end.getparent().remove(end)

    after, allowed = _sabotage(blob, mutate)
    diffs = diff_outside(blob, after, {allowed})

    assert diffs, "hậu kiểm KHÔNG bắt được việc mất permEnd"


def test_fx15_them_thuoc_tinh_la_vao_doan_bi_bat(blob):
    """Sinh lại `w14:paraId` là mọi comment mồ côi — phải bắt được."""

    def mutate(body, inv):
        para = list(body.iter(qn("w:p")))[10]
        para.set(qn("w14:paraId"), "DEADBEEF")

    after, allowed = _sabotage(blob, mutate)
    diffs = diff_outside(blob, after, {allowed})

    assert diffs
    assert any("w14:paraId" in d.detail for d in diffs)


def test_fx15_sua_part_khac_bi_bat(blob):
    """`styles.xml` không bao giờ được ghi. Đụng vào là hậu kiểm phải kêu."""
    pkg = DocxPackage.load(blob)
    styles = pkg.tree("word/styles.xml")
    etree.SubElement(styles, qn("w:style"))
    pkg.mark_dirty("word/styles.xml")
    after = pkg.to_bytes()

    diffs = diff_outside(blob, after, set())

    assert any(d.part == "word/styles.xml" for d in diffs)


def test_fx15_assert_no_diff_nem_de_rollback(blob):
    def mutate(body, inv):
        next(body.iter(qn("w:sectPr"))).getparent().remove(next(body.iter(qn("w:sectPr"))))

    after, allowed = _sabotage(blob, mutate)

    with pytest.raises(PostcheckFailedError):
        assert_no_diff(blob, after, {allowed})


def test_hau_kiem_khong_bao_dong_gia_khi_ghi_dung(engine, blob):
    """Điều kiện để hai lớp có ích: chúng không được kêu oan."""
    inv = read(blob)
    changes = [
        FieldChange(f.perm_id, "x" * 5)
        for f in inv.fields
        if f.region_kind is RegionKind.ATOMIC_FIELD and f.writable
    ]

    result = engine.apply_field_changes(blob, changes)

    assert result.changed
    assert diff_outside(blob, result.document, {c.perm_id for c in changes}) == []
