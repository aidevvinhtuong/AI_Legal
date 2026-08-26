"""
B1 end-to-end — chat sửa văn bản qua API.

Chạy với `AI_SEMANTIC_ENABLED=false` nên không gọi mô hình thật; điều đó vẫn
kiểm được phần quan trọng nhất: **đường từ chối** và **đường áp dụng đề xuất đi
qua `save_fields()`**, tức vẫn qua allow-list và hậu kiểm.
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
                "title": "Ticket chat",
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


def test_chat_luu_ca_cau_hoi_va_cau_tra_loi(client: TestClient, owner: str, review: dict):
    r = client.post(
        f"/api/v1/reviews/{review['id']}/chat",
        headers=_h(owner),
        json={"content": "Đổi thời hạn thanh toán thành 45 ngày"},
    )
    assert r.status_code == 200, r.text
    messages = r.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"], "phải luôn trả lời, không được im lặng"


def test_chat_ghi_ai_run_de_truy_vet(client: TestClient, owner: str, review: dict):
    """Hệ thống pháp chế: mọi lượt gọi AI phải để lại vết, kể cả lượt bị từ chối."""
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import AiRun

    client.post(
        f"/api/v1/reviews/{review['id']}/chat",
        headers=_h(owner),
        json={"content": "Sửa giúp tôi Điều 14 về luật áp dụng"},
    )
    with session_scope() as db:
        runs = [
            r
            for r in db.execute(select(AiRun).where(AiRun.stage == "chat_edit")).scalars()
            if str(r.review_id) == review["id"]
        ]
    assert runs, "lượt chat phải ghi ai_runs"
    assert runs[-1].prompt_stage == "chat_edit"
    assert runs[-1].prompt_version, "phải ghi version prompt để tái lập"


def test_cau_chat_rong_bi_chan(client: TestClient, owner: str, review: dict):
    r = client.post(
        f"/api/v1/reviews/{review['id']}/chat", headers=_h(owner), json={"content": "   "}
    )
    assert r.status_code == 422


def test_khong_chat_duoc_khi_dang_cho_duyet(client: TestClient, owner: str, review: dict):
    """
    Người duyệt đang xem bản nào thì phải là bản đó. Chủ ticket sinh đề xuất mới
    giữa lúc chờ duyệt là hai bên nhìn hai thứ khác nhau (giả định A2).
    """
    rid = review["id"]
    assert client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(owner)).status_code == 200

    r = client.post(
        f"/api/v1/reviews/{rid}/chat",
        headers=_h(owner),
        json={"content": "Đổi thời hạn thanh toán"},
    )
    assert r.status_code == 423, r.text


def test_nguoi_khac_khong_chat_duoc(client: TestClient, review: dict):
    van_a = _token(client, "van.a")
    r = client.post(
        f"/api/v1/reviews/{review['id']}/chat",
        headers=_h(van_a),
        json={"content": "xin chào"},
    )
    assert r.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Áp dụng đề xuất — phải đi qua đường ghi duy nhất
# ─────────────────────────────────────────────────────────────────────────────
def _seed_proposal(review_id: str, perm_id: str, text: str, original: str = "") -> str:
    """
    Dựng một đề xuất như luồng chat thật sinh ra.

    `original` phải là giá trị HIỆN TẠI của vùng — luồng thật chụp nó bằng
    `_current_value()`. Để rỗng thì hoàn tác sẽ ghi chuỗi rỗng đè lên, và đó là
    lỗi của dữ liệu test chứ không phải của code.
    """
    from app.infra.db import session_scope
    from app.infra.models import AiProposal

    with session_scope() as db:
        row = AiProposal(
            review_id=review_id,
            kind="A",
            field_id=perm_id,
            title="Đề xuất thử",
            reason="test",
            original_text=original,
            proposed_text=text,
            status="pending",
            confidence=0,
        )
        db.add(row)
        db.flush()
        return str(row.id)


def test_chap_nhan_de_xuat_thi_ghi_file_va_bump_version(
    client: TestClient, owner: str, review: dict
):
    rid = review["id"]
    writable = next(f for f in review["fields"] if not f["locked"])
    pid = _seed_proposal(rid, writable["id"], "GIÁ TRỊ MỚI SAU CHAT")

    before_version = review["version"]
    r = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "accepted"}
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["version"] > before_version, "ghi file phải sinh version mới"
    updated = next(f for f in body["fields"] if f["id"] == writable["id"])
    assert updated["value"] == "GIÁ TRỊ MỚI SAU CHAT"
    assert body["versionHistory"][-1]["fieldDiff"], "phải có diff cấp field để truy vết"


def test_bo_de_xuat_khong_ghi_file(client: TestClient, owner: str, review: dict):
    rid = review["id"]
    writable = next(f for f in review["fields"] if not f["locked"])
    pid = _seed_proposal(rid, writable["id"], "KHÔNG ĐƯỢC GHI")

    body = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "rejected"}
    ).json()

    assert body["version"] == review["version"], "bỏ đề xuất không được sinh version"
    updated = next(f for f in body["fields"] if f["id"] == writable["id"])
    assert updated["value"] != "KHÔNG ĐƯỢC GHI"


def test_de_xuat_nham_vung_khoa_bi_allowlist_chan(client: TestClient, owner: str, review: dict):
    """
    ★ Chốt an toàn cuối. Dù đề xuất từ đâu tới — chat, LLM bị lừa, request giả —
    allow-list Lớp 1 vẫn chặn vì nó đọc kiểm kê từ chính file (bất biến B1).
    """
    rid = review["id"]
    locked = next((f for f in review["fields"] if f["locked"]), None)
    if locked is None:
        pytest.skip("tài liệu này không có vùng khoá được kiểm kê")
    pid = _seed_proposal(rid, locked["id"], "GHI VÀO VÙNG KHOÁ")

    r = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "accepted"}
    )
    assert r.status_code == 422
    assert r.json()["code"] == "write_rejected"


def test_accept_all_chi_sinh_dung_mot_version(client: TestClient, owner: str, review: dict):
    """
    Chấp nhận n đề xuất theo vòng lặp sẽ sinh n version và lịch sử không đọc được.

    Chỉ dùng vùng `atomic_field`: vùng `block_region` phải giữ nguyên số đoạn
    nên không nhận được chuỗi một dòng (xem `writer_block`).
    """
    rid = review["id"]
    writable = [f for f in review["fields"] if f["regionKind"] == "atomic_field"][:2]
    if len(writable) < 2:
        pytest.skip("cần ít nhất 2 vùng ghi được")
    for index, f in enumerate(writable):
        _seed_proposal(rid, f["id"], f"GIÁ TRỊ {index}")

    body = client.post(f"/api/v1/reviews/{rid}/proposals/accept-all", headers=_h(owner)).json()

    assert body["version"] == review["version"] + 1, "đúng MỘT version cho cả lô"
    values = {f["id"]: f["value"] for f in body["fields"]}
    for index, f in enumerate(writable):
        assert values[f["id"]] == f"GIÁ TRỊ {index}"


# ─────────────────────────────────────────────────────────────────────────────
# Hoàn tác
# ─────────────────────────────────────────────────────────────────────────────
def test_hoan_tac_ghi_lai_gia_tri_cu_va_sinh_version_moi(
    client: TestClient, owner: str, review: dict
):
    """
    Undo KHÔNG xoá version. `review_versions` là snapshot bất biến — xoá đi thì
    lịch sử nói dối. Undo là một thay đổi mới và phải để lại vết như mọi thay
    đổi khác.
    """
    rid = review["id"]
    field = next(f for f in review["fields"] if f["regionKind"] == "atomic_field")
    before_value = field["value"]
    pid = _seed_proposal(rid, field["id"], "GIÁ TRỊ TỪ ĐỀ XUẤT", original=before_value)

    applied = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "accepted"}
    ).json()
    assert next(f for f in applied["fields"] if f["id"] == field["id"])["value"] == (
        "GIÁ TRỊ TỪ ĐỀ XUẤT"
    )

    undone = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "undone"}
    )
    assert undone.status_code == 200, undone.text
    body = undone.json()
    assert next(f for f in body["fields"] if f["id"] == field["id"])["value"] == before_value
    assert body["version"] == applied["version"] + 1, "hoàn tác cũng là một version"


def test_khong_hoan_tac_duoc_khi_vung_da_bi_sua_tiep(client: TestClient, owner: str, review: dict):
    """
    Ghi đè lại `original_text` lúc này là xoá mất thay đổi mới của người dùng mà
    không báo. Thà từ chối và nói rõ.
    """
    rid = review["id"]
    field = next(f for f in review["fields"] if f["regionKind"] == "atomic_field")
    pid = _seed_proposal(rid, field["id"], "TỪ ĐỀ XUẤT")

    client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "accepted"}
    )
    client.put(
        f"/api/v1/reviews/{rid}/fields",
        headers=_h(owner),
        json={"fields": [{"id": field["id"], "value": "NGƯỜI DÙNG SỬA TIẾP"}]},
    )

    r = client.post(
        f"/api/v1/reviews/{rid}/proposals/{pid}", headers=_h(owner), json={"status": "undone"}
    )
    assert r.status_code == 409
    assert r.json()["code"] == "proposal_superseded"
