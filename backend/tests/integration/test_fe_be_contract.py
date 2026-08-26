"""
Hợp đồng FE ↔ BE — chặn tái diễn các chỗ hai bên từng nói khác ngôn ngữ.

Không phải test nghiệp vụ. Mỗi bài ở đây tương ứng một lỗi đã gặp thật: FE gọi
một đường dẫn backend không có, hoặc gọi đúng đường nhưng bị 403 vì guard đặt
sai tầng, hoặc đọc một khoá backend không trả. Kiểu lỗi này không bao giờ lộ ra
ở unit test của từng bên — chỉ lộ khi ghép.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

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
def admin(client: TestClient) -> str:
    return _token(client, "admin", "admin")


@pytest.fixture(scope="module")
def legal(client: TestClient) -> str:
    return _token(client, "legal")


@pytest.fixture(scope="module")
def owner(client: TestClient) -> str:
    return _token(client, "van.a")


# ─────────────────────────────────────────────────────────────────────────────
# Danh bạ người ký
# ─────────────────────────────────────────────────────────────────────────────
def test_legal_doc_duoc_danh_ba_nhung_khong_doc_duoc_quan_tri_users(
    client: TestClient, legal: str
) -> None:
    """
    Bảng Phân quyền ký của Legal cần danh sách người để chọn người ký.

    Trước đây nó gọi `GET /users` (quyền `users`, chỉ IT) và nhận 403; FE dùng
    `Promise.all` nên cả bảng trắng luôn dù ba nguồn còn lại vẫn 200.
    """
    assert client.get("/api/v1/users", headers=_h(legal)).status_code == 403

    r = client.get("/api/v1/users/directory", headers=_h(legal))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "danh bạ rỗng thì dropdown chọn người ký vô dụng"

    # Đúng những trường một dropdown cần, KHÔNG kèm dữ liệu quản trị
    for row in rows:
        assert set(row) == {"id", "username", "fullName", "email", "phone", "active"}
        assert row["active"] is True


def test_danh_ba_khong_mo_cho_nguoi_khong_co_quyen_nao(client: TestClient, owner: str) -> None:
    """Purchasing không cấu hình gì — không có lý do đọc danh bạ toàn công ty."""
    assert client.get("/api/v1/users/directory", headers=_h(owner)).status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Form lists — FE lưu nguyên khối
# ─────────────────────────────────────────────────────────────────────────────
def test_form_lists_ghi_ca_bang_round_trip(client: TestClient, admin: str) -> None:
    """
    `PUT /form-lists` từng không tồn tại (chỉ có GET) → mọi thao tác trên màn
    Configurations của IT trả 405 và không lưu được gì.
    """
    before = client.get("/api/v1/form-lists?includeArchived=true", headers=_h(admin)).json()

    r = client.put("/api/v1/form-lists", headers=_h(admin), json=before)
    assert r.status_code == 200, r.text
    after = r.json()

    # Ghi lại y nguyên thì không được mất, thêm, hay đổi id của mục nào
    for kind in before:
        assert [i["id"] for i in after[kind]] == [i["id"] for i in before[kind]], kind


def test_form_lists_them_sua_xoa_mot_muc(client: TestClient, admin: str) -> None:
    state = client.get("/api/v1/form-lists?includeArchived=true", headers=_h(admin)).json()
    n = len(state["contractBases"])

    state["contractBases"].append({"id": "cb_rt_test", "code": "RT", "label": "Hợp đồng test"})
    added = client.put("/api/v1/form-lists", headers=_h(admin), json=state).json()
    assert len(added["contractBases"]) == n + 1
    assert any(i["id"] == "cb_rt_test" for i in added["contractBases"])

    state = added
    for item in state["contractBases"]:
        if item["id"] == "cb_rt_test":
            item["label"] = "Đã đổi nhãn"
    renamed = client.put("/api/v1/form-lists", headers=_h(admin), json=state).json()
    got = next(i for i in renamed["contractBases"] if i["id"] == "cb_rt_test")
    assert got["label"] == "Đã đổi nhãn"

    state = renamed
    state["contractBases"] = [i for i in state["contractBases"] if i["id"] != "cb_rt_test"]
    removed = client.put("/api/v1/form-lists", headers=_h(admin), json=state).json()
    assert len(removed["contractBases"]) == n


def test_form_lists_khong_xoa_duoc_muc_dang_co_hop_dong_dung(
    client: TestClient, admin: str
) -> None:
    """
    Guard "đang dùng thì chỉ được Lưu trữ" của DELETE per-item phải còn nguyên
    khi đi qua đường ghi cả bảng — nếu không, một cú Lưu là mất dấu vết hợp
    đồng cũ được tạo theo giá trị danh mục nào.
    """
    reviews = client.get("/api/v1/reviews", headers=_h(admin)).json()
    in_use = {
        (r.get("intake") or {}).get("documentCategoryId")
        for r in reviews
        if (r.get("intake") or {}).get("documentCategoryId")
    }
    if not in_use:
        pytest.skip("chưa có ticket nào tham chiếu Loại hợp đồng")
    victim = sorted(in_use)[0]

    state = client.get("/api/v1/form-lists?includeArchived=true", headers=_h(admin)).json()
    kept = len(state["documentCategories"])
    state["documentCategories"] = [i for i in state["documentCategories"] if i["id"] != victim]

    r = client.put("/api/v1/form-lists", headers=_h(admin), json=state)
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "catalog_item_in_use"

    # Và phải rollback sạch, không xoá dở một nửa
    after = client.get("/api/v1/form-lists?includeArchived=true", headers=_h(admin)).json()
    assert len(after["documentCategories"]) == kept


def test_form_lists_can_quyen_form_lists(client: TestClient, legal: str) -> None:
    state = client.get("/api/v1/form-lists", headers=_h(legal)).json()
    assert client.put("/api/v1/form-lists", headers=_h(legal), json=state).status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Bí danh cấu hình theo lớp
# ─────────────────────────────────────────────────────────────────────────────
def test_bi_danh_config_theo_lop_ton_tai(client: TestClient, legal: str) -> None:
    """FE gọi cấu hình bằng khoá nghiệp vụ, không bằng id bản ghi."""
    configs = client.get("/api/v1/config/versions", headers=_h(legal)).json()
    child = next((c for c in configs if c.get("configLayer") == "child"), None)
    if child is None:
        pytest.skip("chưa có overlay checklist nào để thử")
    slug = child["contractTypeId"]

    assert (
        client.post(f"/api/v1/config/contract-types/{slug}/archive", headers=_h(legal)).status_code
        == 200
    )
    assert (
        client.post(f"/api/v1/config/contract-types/{slug}/restore", headers=_h(legal)).status_code
        == 200
    )


def test_xoa_checklist_loai_cha_bi_tu_choi_co_ly_do(client: TestClient, legal: str) -> None:
    """
    Bí danh dùng CHUNG handler với `/config/versions`, nên luật "loại cha chỉ
    được Lưu trữ" chỉ tồn tại ở một chỗ — và trả 409 có mã, không phải 404.
    """
    configs = client.get("/api/v1/config/versions", headers=_h(legal)).json()
    parent = next((c for c in configs if c.get("configLayer") == "parent"), None)
    if parent is None:
        pytest.skip("chưa có checklist loại cha nào để thử")

    r = client.delete(
        f"/api/v1/config/parent-categories/{parent['contractTypeId']}", headers=_h(legal)
    )
    assert r.status_code == 409
    assert r.json()["code"] == "cannot_delete_parent_config"


# ─────────────────────────────────────────────────────────────────────────────
# Optimistic locking
# ─────────────────────────────────────────────────────────────────────────────
def test_if_match_doc_tu_header_chu_khong_phai_query(client: TestClient) -> None:
    """
    `request_if_match: int | None = None` khai trần biến nó thành **query
    param**; header `If-Match` không bao giờ được đọc và kiểm phiên bản im lặng
    không chạy. Bài này canh nó không tái diễn.
    """
    from app.main import app

    schema = app.openapi()
    for path in ("/api/v1/reviews/{review_id}/intake", "/api/v1/reviews/{review_id}/fields"):
        for op in schema["paths"][path].values():
            names = {p["name"] for p in op.get("parameters", [])}
            assert "request_if_match" not in names, f"{path}: If-Match rò thành query param"
            assert "expected_version" not in names, f"{path}: If-Match rò thành query param"


def _pick_editable(client: TestClient, token: str) -> dict:
    rows = client.get("/api/v1/reviews", headers=_h(token)).json()
    editable = [r for r in rows if r["status"] in ("draft", "reviewed", "rejected")]
    if not editable:
        pytest.skip("chưa có ticket nào ở trạng thái sửa được")
    return client.get(f"/api/v1/reviews/{editable[0]['id']}", headers=_h(token)).json()


def test_ghi_lien_tiep_bang_etag_tra_ve_khong_bi_xung_dot_gia(
    client: TestClient, owner: str
) -> None:
    """
    `row_version` do trigger Postgres tăng, nên object trong session giữ giá
    trị CŨ. Trả ETag từ đó thì lần ghi kế tiếp ăn 409 dù chẳng ai sửa cùng.
    """
    review = _pick_editable(client, owner)
    rid = review["id"]
    base = {"intake": review.get("intake") or {}, "contractTypeId": review["contractTypeId"]}

    first = client.patch(
        f"/api/v1/reviews/{rid}/intake",
        headers={**_h(owner), "If-Match": f'"{review["rowVersion"]}"'},
        json={**base, "prompt": "phiên bản A"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["rowVersion"] > review["rowVersion"]
    assert first.headers["ETag"] == f'"{first.json()["rowVersion"]}"'

    second = client.patch(
        f"/api/v1/reviews/{rid}/intake",
        headers={**_h(owner), "If-Match": first.headers["ETag"]},
        json={**base, "prompt": "phiên bản B"},
    )
    assert second.status_code == 200, second.text


def test_ghi_bang_phien_ban_cu_bi_chan(client: TestClient, owner: str) -> None:
    review = _pick_editable(client, owner)
    rid = review["id"]
    stale = review["rowVersion"]
    base = {"intake": review.get("intake") or {}, "contractTypeId": review["contractTypeId"]}

    assert (
        client.patch(
            f"/api/v1/reviews/{rid}/intake",
            headers={**_h(owner), "If-Match": f'"{stale}"'},
            json={**base, "prompt": "ghi lần một"},
        ).status_code
        == 200
    )

    conflict = client.patch(
        f"/api/v1/reviews/{rid}/intake",
        headers={**_h(owner), "If-Match": f'"{stale}"'},
        json={**base, "prompt": "ghi lần hai"},
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["code"] == "stale_version"


def test_khong_gui_if_match_thi_van_ghi_duoc(client: TestClient, owner: str) -> None:
    """Cố ý không bắt buộc: FE cũ chưa gửi header, không được chặn chúng lại."""
    review = _pick_editable(client, owner)
    r = client.patch(
        f"/api/v1/reviews/{review['id']}/intake",
        headers=_h(owner),
        json={
            "intake": review.get("intake") or {},
            "contractTypeId": review["contractTypeId"],
            "prompt": "không kèm If-Match",
        },
    )
    assert r.status_code == 200, r.text


# ─────────────────────────────────────────────────────────────────────────────
# Khoá mà FE đọc
# ─────────────────────────────────────────────────────────────────────────────
def test_system_prompts_tra_dung_khoa_fe_doc(client: TestClient, admin: str) -> None:
    """FE từng đọc `currentFile` trong khi BE trả `fileName` → hiện "undefined"."""
    r = client.get("/api/v1/system-prompts", headers=_h(admin))
    assert r.status_code == 200, r.text
    for prompt in r.json()["prompts"]:
        if prompt.get("error"):
            continue
        assert prompt.get("fileName")
        assert "content" in prompt
        assert isinstance(prompt.get("placeholders"), list)


def test_review_tra_row_version_cho_fe(client: TestClient, owner: str) -> None:
    """Không có `rowVersion` trong payload thì FE không có gì để gửi If-Match."""
    review = _pick_editable(client, owner)
    assert isinstance(review.get("rowVersion"), int)
