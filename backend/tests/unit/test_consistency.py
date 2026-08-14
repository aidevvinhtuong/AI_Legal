"""
Stage 0.5 — bộ quy tắc kiểm tra nhất quán.

Ca gốc lấy từ hợp đồng THACO đang lưu hành (PH-7): cùng số tiền
`685.000.000` được ghi bằng chữ hai kiểu, lệch nhau 1.000 lần. Đây là golden
case đầu tiên của dự án — nếu bộ rule không bắt được nó thì không đáng chạy.
"""

from __future__ import annotations

import pytest

from app.services.ai.consistency import (
    check_amount_in_words,
    check_currency_units,
    check_required_field_filled,
    number_to_vietnamese,
    run_all,
)


@pytest.mark.parametrize(
    ("number", "words"),
    [
        (0, "không"),
        (15, "mười lăm"),
        (21, "hai mươi mốt"),
        (105, "một trăm linh năm"),
        (1_005, "một nghìn không trăm linh năm"),
        (685_000, "sáu trăm tám mươi lăm nghìn"),
        (685_000_000, "sáu trăm tám mươi lăm triệu"),
        (1_000_000_000, "một tỷ"),
        (2_021_500, "hai triệu không trăm hai mươi mốt nghìn năm trăm"),
    ],
)
def test_doc_so_thanh_chu(number, words):
    assert number_to_vietnamese(number) == words


# ─────────────────────────────────────────────────────────────────────────────
# Golden case — lỗi có thật trong hợp đồng đang lưu hành
# ─────────────────────────────────────────────────────────────────────────────
def test_bat_duoc_loi_lech_nghin_lan_cua_hop_dong_thaco():
    text = "tạm ứng 685.000.000 VND (Bằng chữ: Sáu trăm tám mươi lăm nghìn đồng chẵn)"

    issues = check_amount_in_words(text, field_id="1623331172")

    assert len(issues) == 1
    issue = issues[0]
    assert issue.rule == "amount_in_words_mismatch"
    assert issue.severity == "block"
    assert issue.field_id == "1623331172"
    assert "sáu trăm tám mươi lăm triệu" in issue.description


def test_khong_bao_dong_gia_voi_ban_ghi_dung():
    text = "Giá trị Hợp Đồng: 685.000.000 VND (Bằng chữ: Sáu trăm tám lăm triệu đồng chẵn)"
    assert check_amount_in_words(text) == []


@pytest.mark.parametrize(
    "words",
    [
        "Sáu trăm tám mươi lăm triệu đồng",  # cách đọc đầy đủ
        "Sáu trăm tám lăm triệu đồng chẵn",  # nói tắt
        "SÁU TRĂM TÁM MƯƠI LĂM TRIỆU ĐỒNG",  # viết hoa
        "sau tram tam muoi lam trieu dong",  # mất dấu
    ],
)
def test_chap_nhan_moi_bien_the_doc_hop_le(words):
    """Tiếng Việt có nhiều cách đọc đúng — báo sai ở đây là mất niềm tin ngay."""
    assert check_amount_in_words(f"685.000.000 VND (Bằng chữ: {words})") == []


def test_khong_co_cum_bang_chu_thi_khong_ket_luan():
    assert check_amount_in_words("Giá trị hợp đồng là 685.000.000 VND") == []


def test_khong_co_so_dung_truoc_thi_khong_ket_luan():
    """Không đủ căn cứ thì im lặng, thà bỏ sót còn hơn báo bừa."""
    assert check_amount_in_words("Bằng chữ: một tỷ đồng") == []


# ─────────────────────────────────────────────────────────────────────────────
# Rule khác
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("value", ["", "   ", "______", "___ ... ___", "—"])
def test_o_con_de_trong_bi_bat(value):
    issues = check_required_field_filled("123", "Số hợp đồng", value)
    assert len(issues) == 1
    assert issues[0].rule == "empty_required_field"
    assert "Số hợp đồng" in issues[0].title


def test_o_da_dien_thi_khong_bao():
    assert check_required_field_filled("123", "Số hợp đồng", "VTS.HQP.260001") == []


def test_tron_don_vi_tien_te_bi_canh_bao():
    issues = check_currency_units("Thanh toán 1.000 USD tương đương 25.000.000 VND")
    assert len(issues) == 1
    assert issues[0].rule == "mixed_currency"


def test_mot_don_vi_tien_te_thi_binh_thuong():
    assert check_currency_units("Thanh toán 25.000.000 VND") == []


def test_run_all_xep_loi_nghiem_trong_len_truoc():
    fields = [
        ("1", "Số hợp đồng", "______"),
        ("2", "Thanh toán", "685.000.000 VND (Bằng chữ: Sáu trăm tám mươi lăm nghìn đồng)"),
    ]

    issues = run_all(fields)

    assert [i.severity for i in issues] == ["block", "high"]
    assert issues[0].field_id == "2"
