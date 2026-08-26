"""
B6 — TH3: người duyệt đính kèm tệp đã sửa vào lượt Từ chối.

Blueprint A4 đòi *"file đính kèm phải lưu nội dung thật, Purchasing tải được"*.
Trước bộ này, `FeedbackItem.attachments` là cột JSONB nhận nguyên xi thứ client
gửi — tức chỉ `{name, size}`. Người duyệt bấm đính kèm, thấy tên tệp hiện lên,
tưởng đã gửi; Purchasing mở ra thì không có gì để tải.

Ranh giới với PT3 cũng phải giữ được: TH3 KHÔNG thay tài liệu, KHÔNG bump
version, KHÔNG đối chiếu cấu trúc — người duyệt có quyền đề nghị sửa cả vùng
khoá (khoảng trống F6 có thật), chặn họ ở đây là làm mất ý kiến.
"""

from __future__ import annotations

import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from tests.conftest import corpus_path

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def client() -> TestClient:
    pytest.importorskip("psycopg")
    from sqlalchemy import text

    from app.infra.db import engine
    from app.main import app

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"cần Postgres đang chạy: {e}")

    from app.seed import seed

    seed()
    return TestClient(app)


def _token(client: TestClient, username: str) -> str:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "demo123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner(client: TestClient) -> str:
    return _token(client, "thi.b")


@pytest.fixture(scope="module")
def legal(client: TestClient) -> str:
    return _token(client, "legal")


@pytest.fixture
def review(client: TestClient, owner: str) -> dict:
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={
                "title": "Ticket TH3",
                "intake": json.dumps(
                    {
                        "documentCategoryId": "hqp",
                        "businessEntityId": "be_vts",
                        "contractNameId": "cn_hqp_hqp_tour",
                        "contractValue": "500000000",
                    }
                ),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    return r.json()


def _attach(client: TestClient, token: str, review_id: str, name: str, blob: bytes, ctype: str):
    return client.post(
        f"/api/v1/reviews/{review_id}/attachments",
        headers=_h(token),
        data={"note": "Bản đã sửa offline"},
        files={"file": (name, blob, ctype)},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Nội dung thật, tải về được
# ─────────────────────────────────────────────────────────────────────────────
def test_legal_dinh_kem_va_purchasing_tai_ve_dung_noi_dung(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Trọng tâm của bộ này: **byte tải về phải khớp byte gửi lên**.

    Không kiểm bằng tên hay kích thước — cả hai đều khớp ngay cả khi nội dung
    không bao giờ được lưu. Chỉ hash mới chứng minh được.
    """
    rid = review["id"]
    blob = corpus_path("hddv").read_bytes()
    digest = hashlib.sha256(blob).hexdigest()

    created = _attach(
        client,
        legal,
        rid,
        "HD dich vu - Legal sua dieu 4.docx",
        blob,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["name"] == "HD dich vu - Legal sua dieu 4.docx"
    assert item["size"] == len(blob)
    assert item["sha256"] == digest

    # Purchasing tải về
    got = client.get(item["url"], headers=_h(owner))
    assert got.status_code == 200, got.text
    assert hashlib.sha256(got.content).hexdigest() == digest, (
        "nội dung tải về khác nội dung gửi lên"
    )
    # Giữ TÊN GỐC người duyệt đặt — họ đặt tên có nghĩa
    assert "HD dich vu - Legal sua dieu 4.docx" in got.headers["content-disposition"]


def test_dinh_kem_hien_trong_payload_ticket_va_khong_pha_tab_tai_lieu(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    `attachedFiles` là khoá riêng, KHÔNG phải `attachments`.

    `attachments` của FE là danh sách **tab tài liệu** trong khung Word. Nhét tệp
    đính kèm vào đó thì chúng hiện ra thành các tab tài liệu giả, và khung Word
    cố mở một tệp PDF như `.docx`.
    """
    rid = review["id"]
    _attach(client, legal, rid, "ghi-chu.pdf", b"%PDF-1.7 noi dung that", "application/pdf")

    body = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    assert body["attachments"] == [], "tab tài liệu phải giữ nguyên rỗng"
    names = [f["name"] for f in body["attachedFiles"]]
    assert "ghi-chu.pdf" in names


def test_khong_doi_chieu_cau_truc_va_khong_bump_version(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Ranh giới với PT3.

    Người duyệt gửi kèm một tệp **không phải hợp đồng** (hoặc một bản đã sửa cả
    vùng khoá) là hoàn toàn hợp lệ — đó là ý kiến của họ, không phải bản mới của
    tài liệu. Chặn ở đây là làm mất khoảng trống F6.
    """
    rid = review["id"]
    before = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()

    r = _attach(client, legal, rid, "khong-phai-hop-dong.txt", b"chi la ghi chu", "text/plain")
    assert r.status_code == 201, r.text

    after = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    assert after["version"] == before["version"], "đính kèm KHÔNG được bump version"
    assert after["status"] == before["status"], "đính kèm KHÔNG được đổi trạng thái"


# ─────────────────────────────────────────────────────────────────────────────
# Giới hạn
# ─────────────────────────────────────────────────────────────────────────────
def test_khong_nhan_tep_thuc_thi_duoc(client: TestClient, legal: str, review: dict):
    """
    Chặn theo khả năng THỰC THI, không theo "có phải .docx không".

    Người duyệt gửi kèm email khách, ảnh chụp, PDF so sánh — đều hợp lệ. Bắt họ
    đổi định dạng cho vừa hệ thống là sai chỗ.
    """
    r = _attach(
        client, legal, review["id"], "tool.exe", b"MZ\x90\x00", "application/octet-stream"
    )
    assert r.status_code == 422
    assert r.json()["code"] == "executable_not_allowed"


def test_khong_nhan_tep_rong(client: TestClient, legal: str, review: dict):
    r = _attach(client, legal, review["id"], "rong.docx", b"", "application/octet-stream")
    assert r.status_code == 422
    assert r.json()["code"] in ("empty_file", "file_required")


def test_nguoi_ngoai_khong_dinh_kem_duoc(client: TestClient, review: dict):
    """`van.a` là purchasing khác, không phải chủ ticket ⇒ không thấy ticket (A5)."""
    outsider = _token(client, "van.a")
    r = _attach(client, outsider, review["id"], "x.docx", b"abc", "application/octet-stream")
    assert r.status_code in (403, 404), r.text


def test_chu_ticket_cung_dinh_kem_duoc(client: TestClient, owner: str, review: dict):
    """
    Thảo luận hai chiều: Purchasing trả lời bằng biên bản họp, xác nhận NCC…

    Cấm một phía là biến TH3 thành một chiều.
    """
    r = _attach(
        client, owner, review["id"], "bien-ban-hop.pdf", b"%PDF-1.7 bien ban", "application/pdf"
    )
    assert r.status_code == 201, r.text
