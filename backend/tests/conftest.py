"""
Fixture dùng chung. Corpus trỏ thẳng tới file .docx THẬT trong repo —
không copy, không commit nội dung hợp đồng vào Git.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.document.ooxml import DocxPackage

REPO_ROOT = Path(__file__).resolve().parents[2]

# Tên → đường dẫn. Thiếu file nào thì test dùng nó tự skip, không làm đỏ cả bộ.
CORPUS: dict[str, Path] = {
    # Template hợp đồng dịch vụ — bản DUY NHẤT đạt chuẩn trong 4 template
    # (xem docs/template-audit-2026-08.md)
    "hddv": REPO_ROOT / "template" / "0. Template_HDDV_chung_2026.docx",
    # Hợp đồng mua xe đã điền — dùng kiểm ca "một đoạn chứa 2 vùng mở"
    "thaco": REPO_ROOT / "docs" / "HOP DONG MUA XE VAN - VINH TƯƠNG (FN Review) (003) (1).docx",
    # Ba template lỗi — dùng kiểm structural binding phát hiện đúng vấn đề
    "hdvt_ocean": REPO_ROOT / "frontend/public/samples/1. Template_HDVT-OceanFreight_2026.docx",
    "hdvt_fcl": REPO_ROOT / "frontend/public/samples/2. Template_HDVT_ inland FCL_2026.docx",
    "hdvt_dtd": REPO_ROOT / "frontend/public/samples/3. Template_HDVT_DTD_2026.docx",
}


def corpus_path(name: str) -> Path:
    path = CORPUS[name]
    if not path.exists():
        pytest.skip(f"thiếu file corpus: {path.name}")
    return path


def load(name: str) -> DocxPackage:
    return DocxPackage.load(corpus_path(name).read_bytes())


@pytest.fixture
def hddv() -> DocxPackage:
    return load("hddv")


@pytest.fixture
def thaco() -> DocxPackage:
    return load("thaco")


@pytest.fixture(params=["hddv", "thaco", "hdvt_ocean", "hdvt_fcl", "hdvt_dtd"])
def any_docx(request: pytest.FixtureRequest) -> tuple[str, DocxPackage]:
    """Chạy cùng một test trên mọi file thật có sẵn."""
    return request.param, load(request.param)
