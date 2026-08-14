"""Test cấu hình — fail sớm còn hơn chạy sai âm thầm."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.infra.settings import Settings

BASE = {"SECRET_KEY": "x" * 32}


def test_mac_dinh_khop_ha_tang_that():
    s = Settings(**BASE)
    # Ba endpoint đã kiểm chứng bằng scripts/check-llm.py ngày 06/08/2026
    assert s.LLM_MODEL == "Qwen/Qwen3.6-27B"
    assert s.EMBED_DIM == 1024
    # Cổng 8000/8001 đã bị dự án khác chiếm trên máy dev
    assert s.API_PORT == 8010


def test_tat_thinking_mac_dinh():
    """Qwen3 bật thinking sẽ sinh khối <think> rất dài — phải tắt mặc định."""
    assert Settings(**BASE).LLM_ENABLE_THINKING is False


def test_khong_ghi_vung_bac_qua_bang_mac_dinh():
    """Van an toàn: chỉ bật sau khi PoC-1 chứng minh không vỡ bảng."""
    assert Settings(**BASE).ALLOW_CROSS_TABLE_WRITE is False


def test_bo_dau_gach_cheo_cuoi_url():
    s = Settings(**BASE, LLM_BASE_URL="http://x:8386/v1/")
    assert s.LLM_BASE_URL == "http://x:8386/v1"


def test_trong_so_matching_phai_cong_bang_mot():
    with pytest.raises(ValidationError, match=r"phải bằng 1\.0"):
        Settings(**BASE, MATCH_DENSE_WEIGHT=0.9, MATCH_BM25_WEIGHT=0.5)


def test_secret_key_qua_ngan_bi_chan():
    with pytest.raises(ValidationError):
        Settings(SECRET_KEY="ngan")
