"""
Allow-list Lớp 1 — unit test không cần .docx.

Bộ format_fidelity tự skip khi thiếu file corpus, nên luật của Lớp 1 phải có một
lưới an toàn chạy được ở mọi môi trường CI.
"""

from __future__ import annotations

import pytest

from app.services.document.allowlist import AllowList, FieldChange
from app.services.document.model import FieldDescriptor, Mechanism, RegionKind


def make_field(
    perm_id: str,
    kind: RegionKind,
    *,
    writable: bool | None = None,
    para_count: int = 1,
) -> FieldDescriptor:
    if writable is None:
        writable = kind in (RegionKind.ATOMIC_FIELD, RegionKind.BLOCK_REGION)
    return FieldDescriptor(
        perm_id=perm_id,
        mechanism=Mechanism.PERMISSION_RANGE,
        region_kind=kind,
        writable=writable,
        ordinal=int(perm_id),
        inner_text="x" * 10,
        para_ids=tuple(f"P{perm_id}_{i}" for i in range(para_count)),
    )


@pytest.fixture
def allow() -> AllowList:
    return AllowList(
        [
            make_field("1", RegionKind.ATOMIC_FIELD),
            make_field("2", RegionKind.BLOCK_REGION, para_count=3),
            make_field("3", RegionKind.EMPTY),
            make_field("4", RegionKind.CROSS_TABLE),
        ]
    )


def test_vung_atomic_duoc_ghi(allow):
    ok, rejected = allow.filter([FieldChange("1", "giá trị")])
    assert [c.perm_id for c in ok] == ["1"]
    assert rejected == []


def test_vung_block_dung_so_doan_duoc_ghi(allow):
    ok, rejected = allow.filter([FieldChange("2", ["a", "b", "c"])])
    assert len(ok) == 1 and rejected == []


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (FieldChange("999", "x"), "not_in_allowlist"),
        (FieldChange("3", "x"), "empty_region_unsupported"),
        (FieldChange("4", ["x"]), "cross_table_write_disabled"),
        (FieldChange("2", ["a", "b"]), "paragraph_count_mismatch"),
        (FieldChange("2", "một chuỗi"), "value_type_mismatch"),
        (FieldChange("1", ["a"]), "value_type_mismatch"),
        (FieldChange("1", "xin\x00chào"), "illegal_characters"),
    ],
)
def test_cac_truong_hop_bi_tu_choi(allow, change, reason):
    ok, rejected = allow.filter([change])
    assert ok == []
    assert [r.reason for r in rejected] == [reason]


def test_cung_mot_vung_hai_lan_bi_tu_choi_lan_sau(allow):
    """Hai yêu cầu chồng nhau thì yêu cầu sau ghi đè yêu cầu trước một cách âm thầm."""
    ok, rejected = allow.filter([FieldChange("1", "a"), FieldChange("1", "b")])

    assert [c.value for c in ok] == ["a"]
    assert [r.reason for r in rejected] == ["duplicate_change"]


def test_loc_giu_nguyen_thu_tu_va_tach_hai_nhom(allow):
    ok, rejected = allow.filter(
        [
            FieldChange("1", "hợp lệ"),
            FieldChange("999", "độc hại"),
            FieldChange("2", ["a", "b", "c"]),
        ]
    )

    assert [c.perm_id for c in ok] == ["1", "2"]
    assert [r.perm_id for r in rejected] == ["999"]


def test_writable_perm_ids_khong_gom_vung_khong_ghi_duoc(allow):
    assert allow.writable_perm_ids == frozenset({"1", "2"})
    assert allow.allows("3") is False


def test_ky_tu_xuong_dong_va_tab_van_hop_le(allow):
    """`\\n`, `\\t`, `\\r` là nội dung hợp lệ của Word, không phải ký tự điều khiển cấm."""
    ok, rejected = allow.filter([FieldChange("1", "dòng 1\ndòng 2\tcột")])
    assert len(ok) == 1 and rejected == []
