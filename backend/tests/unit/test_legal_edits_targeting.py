"""
Quy chiếu đề xuất TH2 về vùng mở — phần an toàn nhất của tính năng.

Ca quan trọng nhất là **đoạn hỗn hợp** (F10): vùng mở nằm giữa câu bị Legal
khoá. Sửa đúng con số trong vùng mở thì áp được; động vào chữ xung quanh thì
phải bị chặn. Nếu file test này xanh mà logic vẫn sai, thiệt hại vẫn bị chặn ở
allow-list Lớp 1 — nhưng lúc đó người dùng nhận một đề xuất "áp thành công" mà
nội dung sai chỗ, nên vẫn phải đúng ngay từ đây.
"""

from __future__ import annotations

import pytest

from app.services.document.model import ParagraphDescriptor
from app.services.review.legal_edits import EditIn, changed_span, resolve_target


class FakeField:
    """Đủ hình dạng `DocumentField` cho `resolve_target` — không cần chạm DB."""

    def __init__(self, perm_id, para_ids, writable=True):
        self.perm_id = perm_id
        self.para_ids = list(para_ids)
        self.writable = writable


def segments(*pairs):
    """`{perm_id: {para_id: text phần nằm trong vùng}}` — hình dạng thật của tham số."""
    return {perm_id: {para_id: text} for perm_id, para_id, text in pairs}


# Đoạn hỗn hợp thật, dựng theo Điều 3.1 của template HDDV
MIXED = "Bên Bán giao hàng cho Bên Mua trong vòng 30 ngày kể từ ngày ký hợp đồng."
PARA = ParagraphDescriptor(para_id="AAAA1111", ordinal=12, text=MIXED)


def edit(before: str, after: str, kind: str = "replace", para_id: str = "AAAA1111") -> EditIn:
    return EditIn(para_id=para_id, kind=kind, before=before, after=after)


# ─────────────────────────────────────────────────────────────────────────────
# changed_span
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        ("30 ngày", "45 ngày", (0, "30", "45")),
        ("giao trong 30 ngày", "giao trong 45 ngày", (11, "30", "45")),
        ("giao trong 30 ngày", "giao trong 30 ngày làm việc", (18, "", " làm việc")),
        ("giao trong 30 ngày làm việc", "giao trong 30 ngày", (18, " làm việc", "")),
    ],
    ids=["thay", "thay-giữa-câu", "chèn-thêm", "xoá-bớt"],
)
def test_changed_span(before, after, expected):
    assert changed_span(before, after) == expected


def test_changed_span_khong_de_hai_dau_an_lan_nhau():
    """
    Chuỗi lặp là chỗ dễ sai nhất: cắt hậu tố mà không dừng trước tiền tố thì
    `offset` vượt qua điểm kết thúc và mẩu "đã đổi" tính ra âm.
    """
    offset, old, new = changed_span("aaa", "aaaa")
    assert old == ""
    assert new == "a"
    assert offset + len(old) <= len("aaa")


# ─────────────────────────────────────────────────────────────────────────────
# resolve_target — đoạn hỗn hợp
# ─────────────────────────────────────────────────────────────────────────────
def test_sua_trong_vung_mo_thi_ap_duoc():
    fields = [FakeField("P1", ["AAAA1111"])]
    segs = segments(("P1", "AAAA1111", "30"))
    after = MIXED.replace("30 ngày", "45 ngày")
    result = resolve_target(PARA, edit(MIXED, after), fields, segs)
    assert result["target"] == "open"
    assert result["permId"] == "P1"
    assert result["reason"] is None


def test_sua_chu_thuoc_vung_khoa_thi_bi_chan():
    """Đây là ca C-3 thật: người duyệt sửa câu do Legal khoá, ngay cạnh vùng mở."""
    fields = [FakeField("P1", ["AAAA1111"])]
    segs = segments(("P1", "AAAA1111", "30"))
    after = MIXED.replace("Bên Bán giao hàng", "Bên Bán bàn giao")
    result = resolve_target(PARA, edit(MIXED, after), fields, segs)
    assert result["target"] == "locked"
    assert result["permId"] is None


def test_sua_lan_ca_hai_ben_thi_bi_chan():
    """Mẩu đổi bắc qua ranh giới vùng mở — phải chặn, không được cắt bớt cho vừa."""
    fields = [FakeField("P1", ["AAAA1111"])]
    segs = segments(("P1", "AAAA1111", "30"))
    after = MIXED.replace("vòng 30 ngày", "vòng 45 tuần")
    result = resolve_target(PARA, edit(MIXED, after), fields, segs)
    assert result["target"] == "locked"


def test_doan_khong_thuoc_vung_mo_nao():
    result = resolve_target(PARA, edit(MIXED, MIXED + " Bổ sung."), [], {})
    assert result["target"] == "locked"
    assert "vùng mở" in result["reason"]


def test_vung_mo_khong_ghi_duoc_thi_khong_tinh_la_vung_mo():
    """`writable=False` = vùng rỗng / bắc qua bảng — nhìn thấy nhưng không ghi được."""
    fields = [FakeField("P1", ["AAAA1111"], writable=False)]
    segs = segments(("P1", "AAAA1111", "30"))
    after = MIXED.replace("30 ngày", "45 ngày")
    assert resolve_target(PARA, edit(MIXED, after), fields, segs)["target"] == "locked"


def test_doan_co_hai_vung_mo_cung_khop_thi_tu_choi_vi_nhap_nhang():
    """
    Hai vùng mở cùng chứa mẩu bị đổi ⇒ không đoán. Đoán sai là ghi vào vùng
    người dùng không định sửa, mà cả hai đều hợp lệ nên không có cách phát hiện.
    """
    para = ParagraphDescriptor(
        para_id="AAAA1111", ordinal=1, text="Giao 30 ngày, bảo hành 30 ngày."
    )
    fields = [
        FakeField("P1", ["AAAA1111"]),
        FakeField("P2", ["AAAA1111"]),
    ]
    # "30" xuất hiện hai lần trong đoạn ⇒ không định vị được vùng nào, và cũng
    # KHÔNG được đoán: đoán sai là ghi vào chỗ người dùng không định sửa.
    segs = segments(("P1", "AAAA1111", "30"), ("P2", "AAAA1111", "30"))
    before = para.text
    after = "Giao 45 ngày, bảo hành 30 ngày."
    result = resolve_target(para, edit(before, after), fields, segs)
    assert result["target"] == "locked"


def test_vung_trai_nhieu_doan_thi_doan_nam_tron_ben_trong():
    """
    Vùng `clause_block` (vd. toàn bộ Điều 4 Thanh toán) trải nhiều đoạn — đoạn
    này nằm trọn bên trong nên khỏi phải tính span trong câu.
    """
    fields = [FakeField("P9", ["AAAA1111", "BBBB2222", "CCCC3333"])]
    segs = segments(("P9", "AAAA1111", MIXED))  # đoạn nằm TRỌN trong vùng
    result = resolve_target(PARA, edit(MIXED, MIXED + " Thêm câu."), fields, segs)
    assert result["target"] == "open"
    assert result["permId"] == "P9"


def test_vung_nhieu_doan_ket_thuc_giua_doan_thi_van_chan_dung():
    """
    Ca đã đo được trên template HDDV thật: vùng `1623331172` (Điều 4 Thanh toán)
    có một đoạn chỉ nằm MỘT PHẦN trong vùng.

    Trước đây code coi mọi đoạn của vùng nhiều đoạn là "nằm trọn bên trong" nên
    cho qua tất. Hậu quả không phải vi phạm C-3 — writer vẫn chỉ ghi trong vùng
    — mà là ghi **sai nội dung**: cả câu bị khoá bị nhét vào trong vùng mở.
    """
    text = "Nếu Bên Mua thanh toán không đúng hạn, Bên Bán được tính lãi 0,05%/ngày."
    para = ParagraphDescriptor(para_id="DDDD4444", ordinal=80, text=text)
    fields = [FakeField("P4", ["CCCC3333", "DDDD4444"])]
    # Vùng kết thúc ngay sau "đúng hạn" — nửa sau của đoạn là chữ Legal khoá
    segs = segments(("P4", "DDDD4444", "Nếu Bên Mua thanh toán không đúng hạn"))

    trong_vung = text.replace("không đúng hạn", "trễ hạn")
    result = resolve_target(para, edit(text, trong_vung, para_id="DDDD4444"), fields, segs)
    assert result["target"] == "open", result

    ngoai_vung = text.replace("lãi 0,05%/ngày", "lãi 0,10%/ngày")
    result = resolve_target(para, edit(text, ngoai_vung, para_id="DDDD4444"), fields, segs)
    assert result["target"] == "locked", result
