"""
M4 end-to-end — wizard trình ký, chèn marker, outbox, callback, đối soát.

Chạy với adapter mock của FPT (chưa có credentials Demo — câu hỏi mở D1e). Mọi
thứ trừ đúng một lần gọi HTTP ra ngoài đều là code thật: validate, chèn marker
vào `.docx` thật, outbox, máy trạng thái, callback, huỷ.

Ba điều bộ test này phải chứng minh:
  1. Không đủ marker thì **không** đẩy được — chặn ở server, không chỉ ở FE.
  2. Bấm Submit nhiều lần vẫn đúng một envelope (idempotency theo `refId`).
  3. Callback không có chữ ký hợp lệ **không** đổi được trạng thái hợp đồng.
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
def admin(client: TestClient) -> str:
    return _token(client, "admin", "admin")


@pytest.fixture(scope="module")
def legal(client: TestClient) -> str:
    return _token(client, "legal")


@pytest.fixture(scope="module", autouse=True)
def signing_rules(client: TestClient, admin: str) -> None:
    """Không có dòng Phân quyền ký thì Legal không duyệt được — dựng trước."""
    users = client.get("/api/v1/users", headers=_h(admin)).json()
    signer = next(u for u in users if u["username"] == "legal")
    r = client.put(
        "/api/v1/signing-rules",
        headers=_h(admin),
        json={
            "rules": [
                {
                    "businessEntityIds": ["be_vts"],
                    "documentCategoryId": "hqp",
                    "minValue": 0,
                    "maxValue": 10_000_000_000,
                    "ecRole": "signer",
                    "userId": signer["id"],
                    "personalName": signer["fullName"],
                    "email": "legal@saint-gobain.local",
                    "signType": "sign_fca.passcode",
                    "order": 1,
                }
            ]
        },
    )
    assert r.status_code == 200, r.text


def _pending_markers(client: TestClient, legal_token: str) -> tuple[str, str]:
    """Ticket đã qua Legal, đang ở `pending_markers`. Trả `(review_id, token chủ ticket)`."""
    owner = _token(client, "thi.b")  # không có Line Manager → thẳng Legal
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        review = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={
                "title": "Ticket M4",
                "intake": json.dumps(
                    {
                        "documentCategoryId": "hqp",
                        "businessEntityId": "be_vts",
                        "contractNameId": "cn_hqp_hqp_dv",
                        "contractValue": "685000000",
                        "documentName": "Hợp đồng dịch vụ M4",
                    }
                ),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert review.status_code == 201, review.text
    rid = review.json()["id"]

    client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(owner))
    approved = client.post(
        f"/api/v1/reviews/{rid}/legal-decision",
        headers=_h(legal_token),
        json={"decision": "approve"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "pending_markers"
    return rid, owner


def _with_counterparty(recipients: list[dict]) -> list[dict]:
    return [
        *recipients,
        {
            "name": "Ông Nguyễn Đức Hồng Cường",
            "email": "cuong@thaco.vn",
            "phone": "0900000000",
            "orgName": "CÔNG TY CP Ô TÔ TRƯỜNG HẢI",
            "isMyOrg": False,
            "partyId": "p_002",
            "partyKind": "organization",
            "ecRole": "signer",
            "signType": "sign_fca.passcode",
            "markerType": "ds",
            "order": 1,
        },
    ]


def _place_all(client: TestClient, rid: str, token: str) -> dict:
    """Gán marker cho mọi người cần, mỗi người một anchor gợi ý khác nhau."""
    anchors = client.get(
        f"/api/v1/reviews/{rid}/marker-anchors?recommended_only=true", headers=_h(token)
    ).json()["anchors"]
    assert anchors, "không tìm được vị trí neo nào"

    review = client.get(f"/api/v1/reviews/{rid}", headers=_h(token)).json()
    need = [r for r in review["recipients"] if r["ecRole"] in ("signer", "clerk")]

    for index, recipient in enumerate(need):
        r = client.post(
            f"/api/v1/reviews/{rid}/markers/place",
            headers=_h(token),
            json={
                "recipientId": recipient["id"],
                "anchor": {
                    "paraId": anchors[index % len(anchors)]["paraId"],
                    "align": "center",
                },
            },
        )
        assert r.status_code == 200, r.text
        review = r.json()
    return review


# ─────────────────────────────────────────────────────────────────────────────
# Bước 1 — người ký
# ─────────────────────────────────────────────────────────────────────────────
def test_luu_luong_ky_va_server_chuan_hoa_lai_id(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()

    saved = client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    assert saved.status_code == 200, saved.text

    recipients = saved.json()["recipients"]
    assert [r["id"] for r in recipients] == ["p_001_r_001", "p_002_r_001"], (
        "id do server cấp, không tin FE — thứ tự này là thứ tự ký thật"
    )
    assert recipients[0]["isMyOrg"] is True, "bên mua phải đứng trước"


def test_thieu_ben_doi_tac_thi_khong_luu_duoc(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()

    r = client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": current["recipients"]},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "isNotExistsIndividual"


def test_nguoi_khac_khong_thao_tac_duoc_luong_ky(client: TestClient, legal: str):
    rid, _ = _pending_markers(client, legal)
    van_a = _token(client, "van.a")
    r = client.get(f"/api/v1/reviews/{rid}/marker-anchors", headers=_h(van_a))
    assert r.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Bước 2 — marker
# ─────────────────────────────────────────────────────────────────────────────
def test_anchor_tra_ve_goi_y_khoi_chu_ky(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    body = client.get(f"/api/v1/reviews/{rid}/marker-anchors", headers=_h(owner)).json()

    assert body["anchors"], "phải có vị trí neo"
    recommended = [a for a in body["anchors"] if a["recommended"]]
    assert recommended, "phải nhận diện được khối chữ ký"
    assert all("paraId" in a for a in body["anchors"])


def test_dat_marker_bang_paraid_thi_khong_phai_xap_xi(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    review = _place_all(client, rid, owner)

    for recipient in review["recipients"]:
        marker = recipient["marker"]
        assert marker["paraId"], "marker phải neo bằng paraId"
        assert marker["approximated"] is False
        assert marker["positionLabel"], "cần nhãn để người dùng biết ô ký nằm ở đâu"


def test_khong_co_paraid_thi_suy_ra_va_danh_dau_xap_xi(client: TestClient, legal: str):
    """
    Đường tạm cho FE cũ còn gửi toạ độ. Vẫn chạy, nhưng phải nói thẳng là xấp xỉ
    — không được để ai tưởng vị trí đúng chỗ đã thả.
    """
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    saved = client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    ).json()

    r = client.post(
        f"/api/v1/reviews/{rid}/markers/place",
        headers=_h(owner),
        json={"recipientId": saved["recipients"][0]["id"], "page": 3, "xPct": 40, "yPct": 70},
    )
    assert r.status_code == 200, r.text
    marker = r.json()["recipients"][0]["marker"]
    assert marker["approximated"] is True
    assert marker["paraId"], "dù xấp xỉ vẫn phải quy về một đoạn thật"


def test_doi_hinh_thuc_ky_thi_go_marker_lech_loai(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    review = _place_all(client, rid, owner)
    assert review["recipients"][0]["marker"]["type"] == "ds"

    changed = client.patch(
        f"/api/v1/reviews/{rid}/recipients/p_001_r_001",
        headers=_h(owner),
        json={"signType": "sign_img"},
    ).json()
    target = next(r for r in changed["recipients"] if r["id"] == "p_001_r_001")
    assert target["markerType"] == "is"
    assert target["marker"] is None, "marker ds cũ không còn hợp lệ với ký ảnh"


def test_go_marker(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    _place_all(client, rid, owner)

    after = client.delete(f"/api/v1/reviews/{rid}/markers/p_001_r_001", headers=_h(owner)).json()
    assert next(r for r in after["recipients"] if r["id"] == "p_001_r_001")["marker"] is None


# ─────────────────────────────────────────────────────────────────────────────
# Bước 3 — đẩy FPT
# ─────────────────────────────────────────────────────────────────────────────
def test_thieu_marker_thi_server_chan_khong_cho_day(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )

    blocked = client.post(f"/api/v1/reviews/{rid}/econtract/push", headers=_h(owner))
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "isNotExistsMarkerField"
    assert client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["status"] == (
        "pending_markers"
    ), "bị chặn thì trạng thái không được đổi"


def test_day_thanh_cong_va_sinh_ban_xuat_ban_rieng(client: TestClient, legal: str):
    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    _place_all(client, rid, owner)

    pushed = client.post(f"/api/v1/reviews/{rid}/econtract/push", headers=_h(owner))
    assert pushed.status_code == 200, pushed.text
    body = pushed.json()
    assert body["status"] == "syncing_econtract"
    assert body["econtractQueued"] is True

    # Bản gốc và bản để ký là HAI tệp khác nhau — bản gốc KHÔNG bị đụng tới
    assert body["econtractDocxUrl"], "phải sinh bản xuất bản riêng để trình ký"

    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import ReviewFile

    with session_scope() as db:
        rows = list(db.execute(select(ReviewFile).where(ReviewFile.review_id == rid)).scalars())
    by_kind = {f.kind: f for f in rows}
    assert "econtract" in by_kind
    assert by_kind["econtract"].sha256 != by_kind["original"].sha256
    assert by_kind["econtract"].storage_key != by_kind["original"].storage_key

    original = client.get(f"/api/v1/reviews/{rid}/files/original", headers=_h(owner))
    signing = client.get(f"/api/v1/reviews/{rid}/files/econtract", headers=_h(owner))
    assert original.status_code == signing.status_code == 200
    assert b"#ds:" not in original.content, "bản gốc không được có marker"
    assert b"#ds:" in signing.content or signing.content[:2] == b"PK", (
        "bản xuất bản phải là gói .docx hợp lệ"
    )

    status = client.get(f"/api/v1/reviews/{rid}/econtract", headers=_h(owner)).json()
    assert status["outbox"]["status"] in ("pending", "sent")


def test_day_hai_lan_van_dung_mot_envelope(client: TestClient, legal: str):
    """Idempotency: UNIQUE (review_id, kind) chặn ở DB, không phụ thuộc FE."""
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import EcontractOutbox
    from app.services.econtract import service as econtract_service

    rid, owner = _pending_markers(client, legal)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    _place_all(client, rid, owner)
    client.post(f"/api/v1/reviews/{rid}/econtract/push", headers=_h(owner))

    with session_scope() as db:
        row = db.execute(
            select(EcontractOutbox).where(EcontractOutbox.ref_id.isnot(None))
        ).scalars()
        outbox = next(r for r in row if str(r.review_id) == rid)
        first = econtract_service.dispatch(db, outbox.id)
        second = econtract_service.dispatch(db, outbox.id)

    assert first["status"] == "sent"
    assert second == {"status": "sent", "envelopeId": first["envelopeId"]}

    again = client.post(f"/api/v1/reviews/{rid}/econtract/push", headers=_h(owner))
    assert again.status_code == 409
    assert again.json()["code"] == "already_pushed"


# ─────────────────────────────────────────────────────────────────────────────
# Callback
# ─────────────────────────────────────────────────────────────────────────────
def _pushed_review(client: TestClient, legal_token: str) -> tuple[str, str, str]:
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import EcontractOutbox
    from app.services.econtract import service as econtract_service

    rid, owner = _pending_markers(client, legal_token)
    current = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    client.put(
        f"/api/v1/reviews/{rid}/recipients",
        headers=_h(owner),
        json={"recipients": _with_counterparty(current["recipients"])},
    )
    _place_all(client, rid, owner)
    client.post(f"/api/v1/reviews/{rid}/econtract/push", headers=_h(owner))

    with session_scope() as db:
        rows = db.execute(select(EcontractOutbox)).scalars()
        outbox = next(r for r in rows if str(r.review_id) == rid)
        result = econtract_service.dispatch(db, outbox.id)
    return rid, owner, result["envelopeId"]


def test_callback_hoan_tat_dua_ticket_sang_signed(client: TestClient, legal: str):
    rid, owner, envelope_id = _pushed_review(client, legal)
    code = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["code"]

    r = client.post(
        "/api/v1/econtract/callback/Flow_finished",
        json={"envelopeId": envelope_id, "refId": code, "envStatus": "Completed"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    assert client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["status"] == "signed"


def test_callback_lap_lai_khong_lam_gi_them(client: TestClient, legal: str):
    rid, owner, envelope_id = _pushed_review(client, legal)
    code = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["code"]
    body = {"envelopeId": envelope_id, "refId": code, "envStatus": "Completed"}

    assert client.post("/api/v1/econtract/callback/Flow_finished", json=body).json()["applied"]
    second = client.post("/api/v1/econtract/callback/Flow_finished", json=body).json()
    assert second["applied"] is False, "callback trùng không được đổi trạng thái lần nữa"


def test_callback_tu_choi_dua_ve_econtract_failed(client: TestClient, legal: str):
    rid, owner, envelope_id = _pushed_review(client, legal)
    code = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["code"]

    client.post(
        "/api/v1/econtract/callback/Recipient_finished",
        json={"envelopeId": envelope_id, "refId": code, "envStatus": "Rejected"},
    )
    body = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()
    assert body["status"] == "econtract_failed", "phải cho thử lại, không kẹt vĩnh viễn"


def test_callback_sai_chu_ky_khong_doi_duoc_trang_thai(client: TestClient, legal: str, monkeypatch):
    """
    Callback là endpoint công khai — không có token của ta. Nếu chữ ký sai mà
    vẫn áp trạng thái thì bất kỳ ai cũng đánh dấu được hợp đồng là "đã ký".
    """
    from app.services.econtract import service as econtract_service

    rid, owner, envelope_id = _pushed_review(client, legal)
    code = client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["code"]

    monkeypatch.setattr(econtract_service, "verify_signature", lambda *_a, **_k: False)
    r = client.post(
        "/api/v1/econtract/callback/Flow_finished",
        json={"envelopeId": envelope_id, "refId": code, "envStatus": "Completed"},
    )
    assert r.status_code == 401
    assert r.json()["accepted"] is False
    assert client.get(f"/api/v1/reviews/{rid}", headers=_h(owner)).json()["status"] == (
        "syncing_econtract"
    )


def test_callback_khong_khop_ticket_van_duoc_ghi_nhat_ky(client: TestClient):
    """Callback tới trước khi ta kịp lưu envelopeId — không phải lỗi, phải giữ lại."""
    from sqlalchemy import select

    from app.infra.db import session_scope
    from app.infra.models import EcontractEvent

    r = client.post(
        "/api/v1/econtract/callback/Recipient_push_info",
        json={"envelopeId": "KHONG-CO-THAT", "envStatus": "Processing"},
    )
    assert r.status_code == 200
    assert r.json() == {
        "accepted": True,
        "applied": False,
        "reason": "review_not_found",
        "status": None,
    }

    with session_scope() as db:
        rows = list(
            db.execute(
                select(EcontractEvent).where(EcontractEvent.envelope_id == "KHONG-CO-THAT")
            ).scalars()
        )
    assert rows, "callback lạc vẫn phải nằm trong nhật ký để điều tra"


# ─────────────────────────────────────────────────────────────────────────────
# Huỷ
# ─────────────────────────────────────────────────────────────────────────────
def test_huy_hop_dong_dang_trinh_ky(client: TestClient, legal: str):
    rid, owner, _ = _pushed_review(client, legal)

    blocked = client.post(
        f"/api/v1/reviews/{rid}/econtract/cancel", headers=_h(owner), json={"reason": ""}
    )
    assert blocked.status_code == 422, "FPT yêu cầu lý do, và người ký sẽ nhìn thấy nó"

    ok = client.post(
        f"/api/v1/reviews/{rid}/econtract/cancel",
        headers=_h(owner),
        json={"reason": "Sai giá trị hợp đồng"},
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["status"] == "econtract_failed"
    assert body["econtract"]["envStatus"] == "Voided"
