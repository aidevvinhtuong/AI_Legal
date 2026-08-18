"""
M2 end-to-end — duyệt hai cấp, checklist hai lớp, phân quyền ký, system prompt.

Bài quan trọng nhất ở đây không phải "duyệt được", mà là **những chỗ phải bị
chặn**: duyệt hộ người khác, từ chối không nêu lý do, và Legal duyệt khi bảng
Phân quyền ký chưa có dòng nào khớp.
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


def _create_review(client: TestClient, token: str, *, owner_category: str = "hqp") -> dict:
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(token),
            data={
                "title": "Ticket M2",
                "intake": json.dumps(
                    {
                        "documentCategoryId": owner_category,
                        "businessEntityId": "be_vts",
                        "contractNameId": "cn_hqp_hqp_dv",
                        "contractValue": "500000000",
                    }
                ),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    return r.json()


# ─────────────────────────────────────────────────────────────────────────────
# Checklist hai lớp
# ─────────────────────────────────────────────────────────────────────────────
def test_tao_checklist_cha_va_overlay_con(client: TestClient, legal: str):
    parent = client.post("/api/v1/config/parent-categories/hqp/ensure", headers=_h(legal))
    assert parent.status_code == 200, parent.text
    assert parent.json()["configLayer"] == "parent"

    # Gọi lần hai không được sinh bản mới
    again = client.post("/api/v1/config/parent-categories/hqp/ensure", headers=_h(legal))
    assert again.json()["id"] == parent.json()["id"]

    child = client.post("/api/v1/config/contract-names/cn_hqp_hqp_dv/ensure", headers=_h(legal))
    assert child.status_code == 200
    assert child.json()["configLayer"] == "child"
    assert child.json()["parentCategoryId"] == "hqp"


def test_gop_cha_con_con_thang_khi_trung_ma(client: TestClient, legal: str):
    """Quy tắc cốt lõi của Blueprint §3: cùng `code` thì bản overlay thắng."""
    parent = client.post("/api/v1/config/parent-categories/hqp/ensure", headers=_h(legal)).json()
    child = client.post(
        "/api/v1/config/contract-names/cn_hqp_hqp_dv/ensure", headers=_h(legal)
    ).json()

    client.put(
        f"/api/v1/config/versions/{parent['id']}",
        headers=_h(legal),
        json={
            "clauses": [
                {"code": "CL-001", "name": "Thanh toán", "severity": "block", "sortOrder": 0},
                {"code": "CL-002", "name": "Bảo hành", "severity": "warn_high", "sortOrder": 1},
            ]
        },
    )
    client.put(
        f"/api/v1/config/versions/{child['id']}",
        headers=_h(legal),
        json={
            "clauses": [
                {
                    "code": "CL-001",
                    "name": "Thanh toán (riêng cho dịch vụ)",
                    "severity": "block",
                    "sortOrder": 0,
                },
                {"code": "CL-900", "name": "Điều khoản riêng", "severity": "warn_low"},
            ]
        },
    )

    merged = client.get("/api/v1/config/merged/cn_hqp_hqp_dv", headers=_h(legal)).json()

    codes = {c["code"]: c["name"] for c in merged["clauses"]}
    assert codes["CL-001"] == "Thanh toán (riêng cho dịch vụ)", "bản con phải thắng"
    assert codes["CL-002"] == "Bảo hành", "điều khoản chỉ có ở cha vẫn phải còn"
    assert "CL-900" in codes, "điều khoản riêng của con phải được thêm"
    assert merged["overriddenCodes"] == ["CL-001"]
    assert merged["hasChildOverlay"] is True


def test_ten_hd_chua_co_overlay_van_huong_checklist_cha(client: TestClient, legal: str):
    client.post("/api/v1/config/parent-categories/hqp/ensure", headers=_h(legal))
    merged = client.get("/api/v1/config/merged/cn_hqp_hqp_tour", headers=_h(legal)).json()

    assert merged["hasChildOverlay"] is False
    assert merged["parentClauseCount"] > 0
    assert len(merged["clauses"]) == merged["parentClauseCount"]


def test_ma_dieu_khoan_tu_sinh_khi_de_trong(client: TestClient, legal: str):
    parent = client.post("/api/v1/config/parent-categories/raw/ensure", headers=_h(legal)).json()
    saved = client.put(
        f"/api/v1/config/versions/{parent['id']}",
        headers=_h(legal),
        json={"clauses": [{"name": "Không có mã"}, {"name": "Cũng không"}]},
    ).json()

    assert [c["code"] for c in saved["clauses"]] == ["CL-001", "CL-002"]


def test_purchasing_khong_vao_duoc_cau_hinh(client: TestClient):
    van_a = _token(client, "van.a")
    assert client.get("/api/v1/config/versions", headers=_h(van_a)).status_code == 403


def test_audit_ghi_lai_thay_doi_cau_hinh(client: TestClient, legal: str):
    rows = client.get("/api/v1/config/audit?contractTypeId=hqp", headers=_h(legal)).json()
    assert rows, "sửa checklist mà không có vết audit"
    assert {r["action"] for r in rows} & {"update_meta", "create_draft"}


# ─────────────────────────────────────────────────────────────────────────────
# Phân quyền ký
# ─────────────────────────────────────────────────────────────────────────────
def test_luu_va_doc_lai_bang_phan_quyen_ky(client: TestClient, admin: str):
    users = client.get("/api/v1/users", headers=_h(admin)).json()
    legal_user = next(u for u in users if u["username"] == "legal")
    manager = next(u for u in users if u["username"] == "manager.pur")

    payload = {
        "rules": [
            {
                "businessEntityIds": ["be_vts"],
                "documentCategoryId": "hqp",
                "minValue": 0,
                "maxValue": 1_000_000_000,
                "ecRole": "reviewer",
                "userId": manager["id"],
                "personalName": manager["fullName"],
                "email": "manager.pur@saint-gobain.local",
                "order": 1,
            },
            {
                "businessEntityIds": ["be_vts"],
                "documentCategoryId": "hqp",
                "minValue": 0,
                "maxValue": 1_000_000_000,
                "ecRole": "signer",
                "userId": legal_user["id"],
                "personalName": legal_user["fullName"],
                "email": "legal@saint-gobain.local",
                "signType": "sign_fca.passcode",
                "order": 2,
            },
        ]
    }
    saved = client.put("/api/v1/signing-rules", headers=_h(admin), json=payload)
    assert saved.status_code == 200, saved.text
    assert len(saved.json()) == 2
    # reviewer phải đứng trước signer
    assert [r["ecRole"] for r in saved.json()] == ["reviewer", "signer"]


def test_nguoi_ky_chinh_bat_buoc_co_email(client: TestClient, admin: str):
    r = client.put(
        "/api/v1/signing-rules",
        headers=_h(admin),
        json={
            "rules": [
                {
                    "businessEntityIds": [],
                    "documentCategoryId": "mro",
                    "ecRole": "signer",
                    "personalName": "Không email",
                    "email": "",
                }
            ]
        },
    )
    assert r.status_code == 422
    assert r.json()["code"] == "signer_email_required"


def test_preview_ma_tran_ky(client: TestClient, admin: str):
    ok = client.post(
        "/api/v1/signing-rules/preview",
        headers=_h(admin),
        json={
            "documentCategoryId": "hqp",
            "businessEntityId": "be_vts",
            "contractValue": "500,000,000",
        },
    ).json()
    assert ok["ready"] is True
    assert [r["ecRole"] for r in ok["recipients"]] == ["reviewer", "signer"]

    miss = client.post(
        "/api/v1/signing-rules/preview",
        headers=_h(admin),
        json={
            "documentCategoryId": "hqp",
            "businessEntityId": "be_vts",
            "contractValue": "99999999999",
        },
    ).json()
    assert miss["ready"] is False
    assert "Phân quyền ký" in miss["reason"]


# ─────────────────────────────────────────────────────────────────────────────
# Luồng duyệt
# ─────────────────────────────────────────────────────────────────────────────
def test_luong_duyet_day_du_manager_roi_legal(client: TestClient, admin: str, legal: str):
    van_a = _token(client, "van.a")  # có Line Manager = manager.pur
    review = _create_review(client, van_a)
    rid = review["id"]

    assert (
        client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(van_a)).json()["status"]
        == "pending_manager"
    )

    manager = _token(client, "manager.pur")
    approved = client.post(
        f"/api/v1/reviews/{rid}/manager-decide",
        headers=_h(manager),
        json={"decision": "approve"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "pending_legal"

    done = client.post(
        f"/api/v1/reviews/{rid}/legal-decision", headers=_h(legal), json={"decision": "approve"}
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["status"] == "pending_markers"
    assert [r["ecRole"] for r in body["recipients"]] == ["reviewer", "signer"], (
        "Legal duyệt phải resolve người ký từ bảng Phân quyền ký"
    )
    assert body["recipients"][0]["isMyOrg"] is True


def test_manager_khong_phai_line_manager_thi_khong_duyet_duoc(client: TestClient):
    van_a = _token(client, "van.a")
    review = _create_review(client, van_a)
    rid = review["id"]
    client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(van_a))

    thi_b = _token(client, "thi.b")
    r = client.post(
        f"/api/v1/reviews/{rid}/manager-decide", headers=_h(thi_b), json={"decision": "approve"}
    )
    assert r.status_code == 403


def test_tu_choi_khong_co_ly_do_bi_chan(client: TestClient, legal: str):
    thi_b = _token(client, "thi.b")  # không có Line Manager → thẳng Legal
    review = _create_review(client, thi_b)
    rid = review["id"]
    assert (
        client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(thi_b)).json()["status"]
        == "pending_legal"
    )

    blocked = client.post(
        f"/api/v1/reviews/{rid}/legal-decision", headers=_h(legal), json={"decision": "reject"}
    )
    assert blocked.status_code == 409
    assert "lý do từ chối" in blocked.json()["detail"]

    ok = client.post(
        f"/api/v1/reviews/{rid}/legal-decision",
        headers=_h(legal),
        json={"decision": "reject", "comment": "Điều khoản thanh toán chưa đạt"},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["status"] == "rejected"
    assert body["feedback"], "phải lưu lại lý do cho Purchasing thấy trên Task"
    assert body["feedback"][0]["comment"] == "Điều khoản thanh toán chưa đạt"


def test_legal_duyet_bi_chan_khi_khong_co_dong_ma_tran_khop(
    client: TestClient, admin: str, legal: str
):
    """
    Ticket giá trị ngoài mọi khoảng đã cấu hình. Phải chặn NGAY tại bước duyệt,
    kèm chỉ dẫn cụ thể — để sang `pending_markers` rồi mới phát hiện thì người
    tạo không tự gỡ được.
    """
    thi_b = _token(client, "thi.b")
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        review = client.post(
            "/api/v1/reviews",
            headers=_h(thi_b),
            data={
                "title": "Giá trị ngoài mọi bậc",
                "intake": json.dumps(
                    {
                        "documentCategoryId": "hqp",
                        "businessEntityId": "be_vts",
                        "contractNameId": "cn_hqp_hqp_dv",
                        "contractValue": "999999999999",
                    }
                ),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        ).json()
    rid = review["id"]
    client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(thi_b))

    flow = client.get(f"/api/v1/reviews/{rid}/signing-flow", headers=_h(legal)).json()
    assert flow["ready"] is False

    blocked = client.post(
        f"/api/v1/reviews/{rid}/legal-decision", headers=_h(legal), json={"decision": "approve"}
    )
    assert blocked.status_code == 409
    assert "Phân quyền ký" in blocked.json()["detail"]


# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────
def test_doc_ba_stage_system_prompt(client: TestClient, admin: str):
    body = client.get("/api/v1/system-prompts", headers=_h(admin)).json()
    stages = {p["stage"] for p in body["prompts"]}
    assert stages == {"checklist_review", "chat_edit", "ai_summary_fairness"}


def test_placeholder_la_bi_chan(client: TestClient, admin: str):
    r = client.put(
        "/api/v1/system-prompts",
        headers=_h(admin),
        json={"stage": "checklist_review", "content": "Xem {{bien_khong_ton_tai}}"},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "unknown_placeholder"


def test_hardcode_noi_dung_phap_ly_bi_chan(client: TestClient, admin: str):
    """Ràng buộc C-12: ngưỡng pháp lý thuộc checklist của Legal, không nằm trong prompt."""
    r = client.put(
        "/api/v1/system-prompts",
        headers=_h(admin),
        json={
            "stage": "checklist_review",
            "content": "Cảnh báo nếu thời hạn thanh toán vượt 60 ngày.",
        },
    )
    assert r.status_code == 422
    assert r.json()["code"] == "hardcoded_legal_content"


def test_legal_khong_sua_duoc_system_prompt(client: TestClient, legal: str):
    """System Prompt là hành vi AI — thuộc IT, không thuộc Legal."""
    assert client.get("/api/v1/system-prompts", headers=_h(legal)).status_code == 403


def test_ticket_khong_ton_tai(client: TestClient, legal: str):
    r = client.post(
        f"/api/v1/reviews/{uuid.uuid4()}/legal-decision",
        headers=_h(legal),
        json={"decision": "approve"},
    )
    assert r.status_code == 404
