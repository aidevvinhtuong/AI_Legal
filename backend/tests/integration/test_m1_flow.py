"""
M1 end-to-end — chạy trên hạ tầng THẬT (Postgres + MinIO của `make infra`).

Kịch bản đúng bằng thứ Purchasing làm trên UI: đăng nhập → xem danh mục → tạo
hợp đồng từ file `.docx` thật → xem vùng mở → sửa một trường → tải file về →
gửi duyệt. Kèm hai bài kiểm tra an toàn quan trọng nhất: người khác không thấy
ticket của mình, và không ghi được vào vùng khoá.

Test ghi vào DB dev và KHÔNG dọn: `review_versions` là append-only nên xoá bị
trigger chặn — đúng như thiết kế. Muốn sạch thì `make down` rồi `make up`.
"""

from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from tests.conftest import corpus_path

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def client() -> TestClient:
    pytest.importorskip("psycopg")
    from app.main import app

    try:
        from sqlalchemy import text

        from app.infra.db import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:  # hạ tầng chưa chạy thì skip, không làm đỏ cả bộ
        pytest.skip(f"cần Postgres đang chạy: {e}")

    from app.seed import seed

    seed()
    return TestClient(app)


def _token(client: TestClient, username: str, password: str = "demo123") -> str:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner_token(client: TestClient) -> str:
    return _token(client, "van.a")


@pytest.fixture(scope="module")
def review(client: TestClient, owner_token: str) -> dict:
    """Tạo một ticket từ template HDDV thật — dùng lại cho cả module."""
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        response = client.post(
            "/api/v1/reviews",
            headers=_auth(owner_token),
            data={
                "title": "Hợp đồng dịch vụ thử nghiệm",
                "kind": "full",
                "intake": json.dumps(
                    {
                        "documentCategoryId": "hqp",
                        "documentCategoryCode": "HQP",
                        "businessEntityId": "be_vts",
                        "businessEntityCode": "VTS",
                        "contractNameId": "cn_hqp_hqp_dv",
                        "contractNameLabel": "Hợp đồng dịch vụ chung",
                        "documentName": "Hợp đồng dịch vụ thử nghiệm",
                        "contractValue": "685000000",
                    }
                ),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert response.status_code == 201, response.text
    return response.json()


# ─────────────────────────────────────────────────────────────────────────────
# Đăng nhập
# ─────────────────────────────────────────────────────────────────────────────
def test_dang_nhap_va_lay_phien(client: TestClient):
    response = client.post("/api/v1/auth/login", json={"username": "van.a", "password": "demo123"})
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "purchasing"
    assert set(body["permissions"]) >= {"task", "contracts", "contracts_create"}

    me = client.get("/api/v1/auth/me", headers=_auth(body["token"]))
    assert me.status_code == 200
    assert me.json()["username"] == "van.a"


def test_sai_mat_khau_khong_lo_username_co_that(client: TestClient):
    wrong_password = client.post(
        "/api/v1/auth/login", json={"username": "van.a", "password": "sai"}
    )
    no_such_user = client.post(
        "/api/v1/auth/login", json={"username": "khong-co-ai", "password": "sai"}
    )
    assert wrong_password.status_code == no_such_user.status_code == 401
    assert wrong_password.json()["detail"] == no_such_user.json()["detail"]


def test_khong_co_token_thi_bi_chan(client: TestClient):
    assert client.get("/api/v1/reviews").status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# Danh mục
# ─────────────────────────────────────────────────────────────────────────────
def test_danh_muc_du_sau_khoi_cho_form_tao_tai_lieu(client: TestClient, owner_token: str):
    response = client.get("/api/v1/catalogs", headers=_auth(owner_token))
    assert response.status_code == 200
    body = response.json()

    assert {"documentCategories", "contractNames", "businessEntities"} <= set(body)
    assert any(c["id"] == "hqp" for c in body["documentCategories"])
    names = body["contractNames"]
    assert names and all("documentCategoryId" in n for n in names)


def test_loc_ten_hop_dong_theo_loai(client: TestClient, owner_token: str):
    response = client.get(
        "/api/v1/catalogs/contractNames?categoryId=hqp", headers=_auth(owner_token)
    )
    assert response.status_code == 200
    assert {n["documentCategoryId"] for n in response.json()} == {"hqp"}


def test_purchasing_khong_sua_duoc_danh_muc(client: TestClient, owner_token: str):
    response = client.post(
        "/api/v1/form-lists/businessEntities",
        headers=_auth(owner_token),
        json={"label": "Công ty lạ"},
    )
    assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Tạo hợp đồng
# ─────────────────────────────────────────────────────────────────────────────
def test_tao_hop_dong_sinh_dung_so_tai_lieu_va_kiem_ke_vung_mo(review: dict):
    assert review["status"] == "reviewed"
    assert review["code"].startswith("VTS.HQP.")
    assert len(review["code"].split(".")[-1]) == 6  # YY + STT4

    # Template HDDV: 15 vùng mở, 13 ghi được (1 rỗng + 1 bắc qua bảng bị khoá)
    fields = review["fields"]
    assert len(fields) == 15
    assert sum(1 for f in fields if not f["locked"]) == 13


def test_diem_so_va_findings_do_code_tinh(review: dict):
    insight = review["contractInsight"]
    assert 0 <= insight["aiConfidenceScore"] <= 70  # chưa có LLM nên có trần
    assert 0 <= insight["fairnessScore"] <= 100
    assert insight["aiSummary"]

    # Vùng không ghi được phải thành đề xuất Loại B (chỉ chú thích)
    kinds = {p["kind"] for p in review["proposals"]}
    assert kinds <= {"A", "B"}
    assert any(p["kind"] == "B" for p in review["proposals"])


def test_file_khong_phai_docx_bi_tu_choi(client: TestClient, owner_token: str):
    response = client.post(
        "/api/v1/reviews",
        headers=_auth(owner_token),
        data={"title": "x", "intake": "{}"},
        files={"file": ("hop-dong.pdf", b"%PDF-1.4 khong phai docx", "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_file_type"


def test_docx_hong_bi_tu_choi_khong_lam_sap_server(client: TestClient, owner_token: str):
    response = client.post(
        "/api/v1/reviews",
        headers=_auth(owner_token),
        data={"title": "x", "intake": "{}"},
        files={"file": ("hong.docx", b"PK\x03\x04 rac", "application/octet-stream")},
    )
    assert response.status_code == 422
    assert response.json()["code"] in {"invalid_docx", "validation_error"}


# ─────────────────────────────────────────────────────────────────────────────
# Phạm vi dữ liệu (A5)
# ─────────────────────────────────────────────────────────────────────────────
def test_chu_ticket_thay_ticket_cua_minh(client: TestClient, owner_token: str, review: dict):
    response = client.get("/api/v1/reviews", headers=_auth(owner_token))
    assert response.status_code == 200
    assert review["id"] in {r["id"] for r in response.json()}


def test_purchasing_khac_khong_thay_va_khong_mo_duoc(client: TestClient, review: dict):
    other = _token(client, "thi.b")

    listing = client.get("/api/v1/reviews", headers=_auth(other))
    assert review["id"] not in {r["id"] for r in listing.json()}

    detail = client.get(f"/api/v1/reviews/{review['id']}", headers=_auth(other))
    assert detail.status_code == 403  # 403 chứ không 404 — không lộ ticket có tồn tại


def test_line_manager_thay_ticket_cua_cap_duoi(client: TestClient, review: dict):
    manager = _token(client, "manager.pur")
    listing = client.get("/api/v1/reviews", headers=_auth(manager))
    assert review["id"] in {r["id"] for r in listing.json()}


def test_legal_thay_tat_ca(client: TestClient, review: dict):
    legal = _token(client, "legal")
    listing = client.get("/api/v1/reviews", headers=_auth(legal))
    assert review["id"] in {r["id"] for r in listing.json()}


# ─────────────────────────────────────────────────────────────────────────────
# Ghi trường — đường ghi duy nhất
# ─────────────────────────────────────────────────────────────────────────────
def test_sua_mot_truong_mo_tao_version_moi(client: TestClient, owner_token: str, review: dict):
    target = next(
        f for f in review["fields"] if not f["locked"] and f["regionKind"] == "atomic_field"
    )

    response = client.put(
        f"/api/v1/reviews/{review['id']}/fields",
        headers=_auth(owner_token),
        json={"fields": [{"id": target["id"], "value": "Thành phố Hà Nội"}]},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["version"] == review["version"] + 1
    updated = next(f for f in body["fields"] if f["id"] == target["id"])
    assert updated["value"] == "Thành phố Hà Nội"

    # Vùng khoá không đổi một ký tự nào
    before = {f["id"]: f["value"] for f in review["fields"] if f["locked"]}
    after = {f["id"]: f["value"] for f in body["fields"] if f["locked"]}
    assert after == before


def test_ghi_vao_vung_khoa_bi_tu_choi_kem_ly_do(client: TestClient, owner_token: str, review: dict):
    locked = next(f for f in review["fields"] if f["locked"])

    response = client.put(
        f"/api/v1/reviews/{review['id']}/fields",
        headers=_auth(owner_token),
        json={"fields": [{"id": locked["id"], "value": "cố tình ghi đè"}]},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "write_rejected"
    assert body["rejections"][0]["permId"] == locked["id"]
    assert body["rejections"][0]["reason"] in {
        "empty_region_unsupported",
        "cross_table_write_disabled",
    }


def test_ghi_vao_perm_id_bia_ra_bi_tu_choi(client: TestClient, owner_token: str, review: dict):
    response = client.put(
        f"/api/v1/reviews/{review['id']}/fields",
        headers=_auth(owner_token),
        json={"fields": [{"id": "999999999", "value": "điều khoản mới"}]},
    )
    assert response.status_code == 422
    assert response.json()["rejections"][0]["reason"] == "not_in_allowlist"


def test_nguoi_khac_khong_ghi_duoc(client: TestClient, review: dict):
    other = _token(client, "thi.b")
    response = client.put(
        f"/api/v1/reviews/{review['id']}/fields",
        headers=_auth(other),
        json={"fields": [{"id": "1", "value": "x"}]},
    )
    assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Tải file
# ─────────────────────────────────────────────────────────────────────────────
def test_tai_file_ve_van_mo_duoc_bang_bo_doc(client: TestClient, owner_token: str, review: dict):
    response = client.get(
        f"/api/v1/reviews/{review['id']}/files/reviewed", headers=_auth(owner_token)
    )
    assert response.status_code == 200
    blob = response.content
    assert blob.startswith(b"PK\x03\x04")

    from app.services.document.ooxml import DocxPackage
    from app.services.document.ooxml_reader import OoxmlReader

    inventory = OoxmlReader().read(DocxPackage.load(blob))
    assert len(inventory.fields) == 15, "tệp tải về mất vùng mở"


def test_nguoi_khac_khong_tai_duoc_file(client: TestClient, review: dict):
    other = _token(client, "thi.b")
    response = client.get(f"/api/v1/reviews/{review['id']}/files/original", headers=_auth(other))
    assert response.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Trạng thái
# ─────────────────────────────────────────────────────────────────────────────
def test_status_tra_hanh_dong_dang_lam_duoc(client: TestClient, owner_token: str, review: dict):
    response = client.get(f"/api/v1/reviews/{review['id']}/status", headers=_auth(owner_token))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "reviewed"
    assert "submit_approval" in body["allowedActions"]


def test_gui_duyet_di_vao_hang_cho_manager(client: TestClient, owner_token: str, review: dict):
    """van.a có Line Manager = manager.pur nên phải vào hàng chờ Manager trước."""
    response = client.post(f"/api/v1/reviews/{review['id']}/submit", headers=_auth(owner_token))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending_manager"


def test_da_gui_duyet_thi_khong_sua_duoc_nua(client: TestClient, owner_token: str, review: dict):
    """Người duyệt xem một đằng mà chủ ticket sửa một nẻo là không chấp nhận được."""
    detail = client.get(f"/api/v1/reviews/{review['id']}", headers=_auth(owner_token)).json()
    target = next(f for f in detail["fields"] if not f["locked"])

    response = client.put(
        f"/api/v1/reviews/{review['id']}/fields",
        headers=_auth(owner_token),
        json={"fields": [{"id": target["id"], "value": "sửa lén"}]},
    )
    assert response.status_code == 423


def test_ticket_khong_ton_tai_tra_404(client: TestClient, owner_token: str):
    response = client.get(f"/api/v1/reviews/{uuid.uuid4()}", headers=_auth(owner_token))
    assert response.status_code == 404
