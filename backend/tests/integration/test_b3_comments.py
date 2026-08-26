"""
B3 — comment 2 chiều theo đoạn / field (TH1).

Ba điều bộ này phải chứng minh:
  1. **Comment được vào vùng KHOÁ.** Đây là ca thật: trong hợp đồng THACO người
     duyệt yêu cầu sửa Điều 3.5 và 3.6, cả hai nằm trọn trong vùng khoá. Hệ
     thống không ghi được vào đó, nhưng phải ghi nhận được yêu cầu.
  2. **Tài liệu đổi thì bình luận mất neo được nói ra**, không im lặng gắn sang
     đoạn khác.
  3. **Đóng thread KHÔNG đổi trạng thái ticket** — quy tắc A4b.
"""

from __future__ import annotations

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


def _token(client: TestClient, username: str, password: str = "demo123") -> str:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def legal(client: TestClient) -> str:
    return _token(client, "legal")


@pytest.fixture(scope="module")
def owner(client: TestClient) -> str:
    return _token(client, "thi.b")


@pytest.fixture
def review(client: TestClient, owner: str) -> dict:
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={
                "title": "Ticket comment",
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


def _writable(review: dict) -> dict:
    return next(f for f in review["fields"] if f["regionKind"] == "atomic_field")


def _locked_para(client: TestClient, token: str, review: dict) -> str:
    """Một `paraId` của đoạn nằm ngoài mọi vùng mở."""
    anchors = client.get(
        f"/api/v1/reviews/{review['id']}/marker-anchors", headers=_h(token)
    ).json()["anchors"]
    return next(a["paraId"] for a in anchors if not a["isOpen"] and a["preview"])


# ─────────────────────────────────────────────────────────────────────────────
# Tạo và trả lời
# ─────────────────────────────────────────────────────────────────────────────
def test_legal_mo_thread_tren_vung_mo_va_owner_tra_loi(
    client: TestClient, legal: str, owner: str, review: dict
):
    rid = review["id"]
    field = _writable(review)

    created = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"permId": field["id"], "content": "Giá trị này cần khớp phụ lục"},
    )
    assert created.status_code == 201, created.text
    thread = created.json()
    assert thread["anchorKind"] == "field"
    assert thread["permId"] == field["id"]
    assert thread["status"] == "open"
    assert thread["quotedText"] == field["value"][:400], "phải chụp lại ngữ cảnh lúc tạo"
    assert len(thread["replies"]) == 1
    assert thread["replies"][0]["authorRole"] == "legal"

    answered = client.post(
        f"/api/v1/reviews/{rid}/comments/{thread['id']}/replies",
        headers=_h(owner),
        json={"content": "Đã kiểm tra, sẽ sửa trong vòng này"},
    )
    assert answered.status_code == 201, answered.text
    replies = answered.json()["replies"]
    assert len(replies) == 2, "thread phải hai chiều"
    assert [r["authorRole"] for r in replies] == ["legal", "purchasing"]


def test_comment_duoc_vao_vung_khoa(client: TestClient, legal: str, owner: str, review: dict):
    """
    ★ Ca thật của hợp đồng THACO: người duyệt yêu cầu sửa Điều 3.5 / 3.6, cả hai
    nằm trọn trong vùng khoá. Hệ thống không ghi được vào đó — nhưng nếu cũng
    không ghi nhận được yêu cầu thì người duyệt không có chỗ nào để nói.
    """
    rid = review["id"]
    para_id = _locked_para(client, owner, review)

    created = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"paraId": para_id, "content": "Điều khoản này cần Legal sửa template"},
    )
    assert created.status_code == 201, created.text
    thread = created.json()
    assert thread["anchorKind"] == "paragraph"
    assert thread["paraId"] == para_id
    assert thread["quotedText"], "phải trích dẫn đoạn để người đọc biết nói về câu nào"


def test_neo_khong_ton_tai_thi_bao_ngay(client: TestClient, legal: str, review: dict):
    r = client.post(
        f"/api/v1/reviews/{review['id']}/comments",
        headers=_h(legal),
        json={"paraId": "KHONGCOTHAT", "content": "x"},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "anchor_not_found"


def test_thieu_neo_bi_chan(client: TestClient, legal: str, review: dict):
    r = client.post(
        f"/api/v1/reviews/{review['id']}/comments",
        headers=_h(legal),
        json={"content": "bình luận trôi nổi"},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "anchor_required"


def test_nguoi_ngoai_pham_vi_khong_doc_duoc(client: TestClient, legal: str, review: dict):
    """A5: Purchasing khác không được biết ticket này có tồn tại hay không."""
    van_a = _token(client, "van.a")
    assert (
        client.get(f"/api/v1/reviews/{review['id']}/comments", headers=_h(van_a)).status_code == 403
    )


# ─────────────────────────────────────────────────────────────────────────────
# Đóng thread
# ─────────────────────────────────────────────────────────────────────────────
def test_dong_thread_khong_doi_trang_thai_ticket(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Quy tắc A4b: yêu cầu chỉnh sửa phải kết thúc bằng Từ chối, KHÔNG phải bằng
    việc đóng bình luận. Trộn hai thứ là có hai đường quay lui.
    """
    rid = review["id"]
    thread = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"permId": _writable(review)["id"], "content": "Xem lại giúp"},
    ).json()

    before = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["status"]
    resolved = client.post(
        f"/api/v1/reviews/{rid}/comments/{thread['id']}/resolve", headers=_h(legal)
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"
    assert resolved.json()["resolvedAt"]

    after = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["status"]
    assert after == before, "đóng bình luận không được đổi trạng thái ticket"


def test_thread_da_dong_khong_tra_loi_them(client: TestClient, legal: str, review: dict):
    rid = review["id"]
    thread = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"permId": _writable(review)["id"], "content": "xong rồi"},
    ).json()
    client.post(f"/api/v1/reviews/{rid}/comments/{thread['id']}/resolve", headers=_h(legal))

    r = client.post(
        f"/api/v1/reviews/{rid}/comments/{thread['id']}/replies",
        headers=_h(legal),
        json={"content": "nói thêm"},
    )
    assert r.status_code == 409
    assert r.json()["code"] == "thread_resolved"


# ─────────────────────────────────────────────────────────────────────────────
# Tái neo khi tài liệu đổi
# ─────────────────────────────────────────────────────────────────────────────
def test_sua_vung_mo_thi_thread_van_song(client: TestClient, legal: str, owner: str, review: dict):
    """
    Bình luận nói về chính vùng đó, và vùng đó chính là chỗ người ta đang sửa —
    nên sửa nội dung KHÔNG làm mất neo.
    """
    rid = review["id"]
    field = _writable(review)
    thread = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"permId": field["id"], "content": "Sửa lại giúp"},
    ).json()

    saved = client.put(
        f"/api/v1/reviews/{rid}/fields",
        headers=_h(owner),
        json={"fields": [{"id": field["id"], "value": "GIÁ TRỊ ĐÃ SỬA"}]},
    )
    assert saved.status_code == 200, saved.text

    threads = client.get(f"/api/v1/reviews/{rid}/comments", headers=_h(legal)).json()
    same = next(t for t in threads if t["id"] == thread["id"])
    assert same["status"] == "open"
    assert same["orphanReason"] is None


def test_doan_khoa_doi_noi_dung_thi_thread_mo_coi_kem_ly_do(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    ★ Thay vì im lặng gắn sang đoạn "gần giống": người duyệt sẽ đọc bình luận
    của mình bên cạnh một câu họ chưa từng nhìn thấy. Nói mất neo là trung thực
    hơn nhiều.
    """
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import CommentThread

    rid = review["id"]
    para_id = _locked_para(client, owner, review)
    thread = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"paraId": para_id, "content": "Đoạn này cần xem lại"},
    ).json()

    # Mô phỏng tài liệu đổi: hash lưu trong thread không còn khớp đoạn thật
    with session_scope() as db:
        row = db.execute(select(CommentThread).where(CommentThread.id == thread["id"])).scalar_one()
        row.text_sha256 = "0" * 64

    threads = client.get(f"/api/v1/reviews/{rid}/comments", headers=_h(legal)).json()
    same = next(t for t in threads if t["id"] == thread["id"])
    assert same["status"] == "orphaned"
    assert "thay đổi" in (same["orphanReason"] or "")
    assert same["quotedText"], "vẫn giữ trích dẫn cũ để đọc lại được thảo luận"


def test_lich_su_tra_loi_khong_sua_duoc(client: TestClient, legal: str, review: dict):
    """Thảo luận là chứng cứ của quyết định phê duyệt — trigger chặn UPDATE."""
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import CommentReply

    rid = review["id"]
    thread = client.post(
        f"/api/v1/reviews/{rid}/comments",
        headers=_h(legal),
        json={"permId": _writable(review)["id"], "content": "nguyên văn"},
    ).json()

    # Lỗi tới từ trigger DB, không phải `AppError` của tầng nghiệp vụ
    with pytest.raises(Exception) as err, session_scope() as db:
        row = (
            db.execute(select(CommentReply).where(CommentReply.thread_id == thread["id"]))
            .scalars()
            .first()
        )
        row.content = "sửa lại lịch sử"
    assert "append-only" in str(err.value).lower() or "immutable" in str(err.value).lower()
