"""
Fixture dùng chung. Corpus trỏ thẳng tới file .docx THẬT trong repo —
không copy, không commit nội dung hợp đồng vào Git.
"""

from __future__ import annotations

import sys
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


@pytest.fixture(scope="module", autouse=True)
def no_active_template():
    """
    Tắt mọi template đang hiệu lực trước mỗi module test integration.

    Vì sao cần: từ B2, upload `.docx` phải khớp cấu trúc template đã đăng ký.
    Test nào tải lên một file bất kỳ sẽ bị chặn 422 nếu **ai đó** — bộ test
    khác, hoặc người dùng bấm trên UI — vừa đăng ký template cho cùng Tên hợp
    đồng. DB dev dùng chung nên đó không phải giả thuyết: đã làm đỏ 20 test.

    Chỉ tắt cờ `is_active`, KHÔNG xoá bản ghi — template là cấu hình của Legal,
    test không được phá. Module nào tự đăng ký template (B2) thì fixture của nó
    chạy sau và bật lại đúng bản của nó.
    """
    if "psycopg" not in sys.modules:
        pytest.importorskip("psycopg")
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import ContractTemplate

    disabled: list = []
    try:
        with session_scope() as db:
            for row in db.execute(
                select(ContractTemplate).where(ContractTemplate.is_active.is_(True))
            ).scalars():
                disabled.append((row.id, row.contract_name_slug))
                row.is_active = False
    except Exception:  # chưa có Postgres — test sẽ tự skip ở fixture `client`
        yield
        return

    yield

    with session_scope() as db:
        for template_id, slug in disabled:
            # Chỉ bật lại khi slug đó hiện KHÔNG có bản nào hiệu lực. Module vừa
            # chạy có thể đã đăng ký bản mới hơn; bật lại bản cũ song song sẽ
            # để hai template cùng hiệu lực cho một Tên hợp đồng.
            newer = (
                db.execute(
                    select(ContractTemplate).where(
                        ContractTemplate.contract_name_slug == slug,
                        ContractTemplate.is_active.is_(True),
                    )
                )
                .scalars()
                .first()
            )
            if newer is None:
                row = db.get(ContractTemplate, template_id)
                if row is not None:
                    row.is_active = True
