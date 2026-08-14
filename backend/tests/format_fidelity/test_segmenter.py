"""Segmenter chạy trên tài liệu thật."""

from __future__ import annotations

import pytest

from app.services.ai.segmenter import segment, segments_for_field
from app.services.document.ooxml_reader import OoxmlReader

pytestmark = pytest.mark.fidelity


def test_cat_duoc_segment_tren_hddv(hddv):
    inv = OoxmlReader().read(hddv)
    segs = segment(inv.paragraphs)

    assert len(segs) > 5, "quá ít segment — nhiều khả năng không nhận ra tiêu đề điều khoản"
    assert sum(len(s.para_ids) for s in segs) == len(inv.paragraphs), "có đoạn bị bỏ rơi"

    all_ids = [pid for s in segs for pid in s.para_ids]
    assert len(all_ids) == len(set(all_ids)), "một đoạn bị gán cho nhiều segment"


def test_segment_mang_theo_so_dieu_khoan(hddv):
    """Không có số hiệu thì finding của AI trích dẫn 'đoạn thứ 75' — vô dụng với Legal."""
    inv = OoxmlReader().read(hddv)
    segs = segment(inv.paragraphs)

    numbered = [s for s in segs if s.numbering_path]
    assert numbered, "không segment nào có số hiệu"
    assert any(s.numbering_path.startswith("Điều") for s in numbered), [
        s.numbering_path for s in numbered[:10]
    ]
    for s in numbered:
        assert s.citation and s.citation != f"Đoạn {s.ordinal}"


def test_segment_biet_minh_nam_trong_vung_mo_hay_khoa(hddv):
    inv = OoxmlReader().read(hddv)
    segs = segment(inv.paragraphs)

    assert any(s.is_open for s in segs), "phải có segment nằm trong vùng mở"
    assert any(not s.is_open for s in segs), "phải có segment nằm trong vùng khoá"

    for s in segs:
        if s.is_open:
            assert s.perm_ids, f"segment {s.ordinal} mở nhưng không gắn perm_id nào"


def test_segment_vat_ngang_ranh_gioi_bi_coi_la_khoa(hddv):
    """Xử lý an toàn về phía chặn: nửa mở nửa khoá ⇒ coi như khoá."""
    inv = OoxmlReader().read(hddv)
    segs = segment(inv.paragraphs)

    by_id = {p.para_id: p for p in inv.paragraphs}
    for s in segs:
        opens = [by_id[i].is_open for i in s.para_ids if i in by_id]
        if opens and not all(opens):
            assert not s.is_open, f"segment {s.ordinal} vắt ngang mà vẫn bị coi là mở"


def test_tra_ve_segment_theo_vung_mo(hddv):
    """Dùng cho field_validation: chỉ đánh giá lại clause liên quan tới vùng vừa sửa."""
    inv = OoxmlReader().read(hddv)
    segs = segment(inv.paragraphs)

    target = "1422276696"  # vùng Thanh toán
    hits = segments_for_field(segs, target)
    assert hits, "không tìm được segment nào thuộc vùng Thanh toán"
    assert all(target in s.perm_ids for s in hits)
    assert len(hits) < len(segs), "phải hẹp hơn toàn bộ tài liệu"


def test_khong_bi_lua_boi_regex_tren_text(hddv):
    """
    PH-6: chữ 'Điều 5.' không có trong text. Nếu segmenter chỉ dựa vào regex text
    thì gần như không cắt được gì — test này bắt đúng trường hợp đó.
    """
    inv = OoxmlReader().read(hddv)
    import re

    in_text = sum(1 for p in inv.paragraphs if re.match(r"^\s*Điều\s+\d+", p.text))
    resolved = sum(
        1 for p in inv.paragraphs if p.numbering_label and p.numbering_label.startswith("Điều")
    )
    assert resolved > in_text, (
        f"resolve numbering phải tìm ra nhiều điều khoản hơn regex text "
        f"(resolve={resolved}, regex={in_text})"
    )
