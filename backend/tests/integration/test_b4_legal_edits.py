"""
B4 — track changes của người duyệt (TH2), và ràng buộc version đi kèm.

Bốn điều bộ này phải chứng minh:

  1. **Vùng đích do SERVER giải.** FE chỉ gửi `paraId`; hệ thống tự tra xem đoạn
     đó thuộc vùng mở nào. Đề xuất chạm vùng khoá được ghi nhận nhưng không áp
     được — đó là đường escalate cho khoảng trống F6, không phải lỗi.
  2. **Áp đề xuất đi qua allow-list.** Không có đường ghi tắt nào.
  3. **A4b tự phát huy.** Người duyệt muốn đề xuất được áp thì phải Từ chối để
     trả hồ sơ về Purchasing — không cần luật riêng cho TH2.
  4. **Từ chối KHÔNG được làm mất tài liệu.** Version Từ chối phải mang tệp và
     kiểm kê vùng theo; thiếu nó thì Purchasing hết sửa được đúng lúc cần sửa
     nhất. Đây là regression cho một bug có thật, đo trên VTS.HQP.261105.
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


def _token(client: TestClient, username: str) -> str:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "demo123"})
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
                "title": "Ticket TH2",
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


def _paragraphs(review: dict) -> list:
    """
    Text ĐÚNG NGUYÊN VĂN của từng đoạn, đọc thẳng từ tệp.

    Không dùng `preview` của `/marker-anchors`: nó gộp khoảng trắng và cắt 120
    ký tự, trong khi backend đối chiếu `before` bằng SHA-256 của text nguyên
    văn. Lấy nhầm nguồn thì test đo sai thứ nó tưởng đang đo.
    """
    import uuid as _uuid

    from app.infra.db import get_session
    from app.infra.models import ContractReview, ReviewFile
    from app.services.document.ooxml import DocxPackage
    from app.services.document.ooxml_reader import OoxmlReader
    from app.services.review import versions
    from app.services.storage.objects import get_storage

    db = next(get_session())
    row = db.get(ContractReview, _uuid.UUID(review["id"]))
    version = versions.current_document(db, row)
    blob = get_storage().get(db.get(ReviewFile, version.file_id).storage_key)
    return list(OoxmlReader().read(DocxPackage.load(blob)).paragraphs)


def _open_anchor(client: TestClient, token: str, review: dict) -> tuple[dict, dict]:
    """Một đoạn thuộc vùng mở ghi được, kèm chính vùng đó."""
    paragraphs = _paragraphs(review)
    for field in review["fields"]:
        if field["locked"] or not field["value"] or len(field["value"]) < 3:
            continue
        for p in paragraphs:
            if field["value"] in p.text:
                return {"paraId": p.para_id, "text": p.text}, field
    pytest.skip("không tìm được đoạn mở phù hợp trong corpus")


def _locked_anchor(client: TestClient, token: str, review: dict) -> dict:
    open_perms = {f["id"] for f in review["fields"]}
    for p in _paragraphs(review):
        if len(p.text.strip()) > 60 and not (set(p.perm_ids) & open_perms):
            return {"paraId": p.para_id, "text": p.text}
    pytest.skip("không tìm được đoạn khoá phù hợp trong corpus")


# ─────────────────────────────────────────────────────────────────────────────
# Quy chiếu vùng đích
# ─────────────────────────────────────────────────────────────────────────────
def test_de_xuat_vao_vung_mo_duoc_server_quy_dung_perm_id(
    client: TestClient, legal: str, review: dict
):
    anchor, field = _open_anchor(client, legal, review)
    before = anchor["text"]
    after = before.replace(field["value"], field["value"] + " (bổ sung)", 1)

    r = client.post(
        f"/api/v1/reviews/{review['id']}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {"paraId": anchor["paraId"], "kind": "replace", "before": before, "after": after}
            ]
        },
    )
    assert r.status_code == 201, r.text
    edit = next(e for e in r.json() if e["paraId"] == anchor["paraId"])
    assert edit["target"] == "open"
    assert edit["permId"] == field["id"], "vùng đích do server tra, không nhận từ client"
    assert edit["addedText"] == " (bổ sung)", "chỉ mẩu đã đổi, không phải cả đoạn"
    assert edit["authorRole"] == "legal"


def test_de_xuat_cham_vung_khoa_duoc_ghi_nhan_nhung_khong_ap_duoc(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Ca thật của F6: người duyệt muốn sửa điều khoản Legal khoá. Vứt yêu cầu đi
    là làm mất một quyết định của người có thẩm quyền, nên vẫn lưu — chỉ là
    không có đường nào ghi vào tài liệu.
    """
    anchor = _locked_anchor(client, legal, review)
    r = client.post(
        f"/api/v1/reviews/{review['id']}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": anchor["text"] + " Bổ sung của Legal.",
                }
            ]
        },
    )
    assert r.status_code == 201, r.text
    edit = next(e for e in r.json() if e["paraId"] == anchor["paraId"])
    assert edit["target"] == "locked"
    assert edit["permId"] is None
    assert edit["blockedReason"]

    denied = client.post(
        f"/api/v1/reviews/{review['id']}/legal-edits/{edit['id']}/decide",
        headers=_h(owner),
        json={"action": "apply"},
    )
    assert denied.status_code == 409
    assert denied.json()["code"] == "edit_targets_locked_region"


def test_purchasing_khong_de_xuat_duoc(client: TestClient, owner: str, review: dict):
    """TH2 là công cụ của người duyệt. Chủ ticket sửa thẳng (PT2) hoặc qua chat."""
    anchor = _locked_anchor(client, owner, review)
    r = client.post(
        f"/api/v1/reviews/{review['id']}/legal-edits",
        headers=_h(owner),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": anchor["text"] + " x",
                }
            ]
        },
    )
    assert r.status_code == 403


def test_de_xuat_khong_doi_gi_bi_chan(client: TestClient, legal: str, review: dict):
    anchor = _locked_anchor(client, legal, review)
    r = client.post(
        f"/api/v1/reviews/{review['id']}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": anchor["text"],
                }
            ]
        },
    )
    assert r.status_code == 422
    assert r.json()["code"] == "empty_edit"


# ─────────────────────────────────────────────────────────────────────────────
# Áp đề xuất
# ─────────────────────────────────────────────────────────────────────────────
def test_ap_de_xuat_ghi_dung_vung_va_bump_version(
    client: TestClient, legal: str, owner: str, review: dict
):
    rid = review["id"]
    anchor, field = _open_anchor(client, legal, review)
    new_value = field["value"] + " (đã sửa)"
    after = anchor["text"].replace(field["value"], new_value, 1)

    created = client.post(
        f"/api/v1/reviews/{rid}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": after,
                }
            ]
        },
    )
    assert created.status_code == 201, created.text
    edit = next(e for e in created.json() if e["target"] == "open")

    applied = client.post(
        f"/api/v1/reviews/{rid}/legal-edits/{edit['id']}/decide",
        headers=_h(owner),
        json={"action": "apply"},
    )
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assert next(e for e in body["edits"] if e["id"] == edit["id"])["status"] == "applied"
    assert body["review"]["version"] == review["version"] + 1

    written = next(f for f in body["review"]["fields"] if f["id"] == field["id"])
    assert written["value"] == new_value


def test_ap_hai_lan_thi_lan_sau_bi_chan(
    client: TestClient, legal: str, owner: str, review: dict
):
    rid = review["id"]
    anchor, field = _open_anchor(client, legal, review)
    after = anchor["text"].replace(field["value"], field["value"] + " (x)", 1)
    created = client.post(
        f"/api/v1/reviews/{rid}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": after,
                }
            ]
        },
    )
    edit = next(e for e in created.json() if e["target"] == "open")
    first = client.post(
        f"/api/v1/reviews/{rid}/legal-edits/{edit['id']}/decide",
        headers=_h(owner),
        json={"action": "apply"},
    )
    assert first.status_code == 200, first.text
    second = client.post(
        f"/api/v1/reviews/{rid}/legal-edits/{edit['id']}/decide",
        headers=_h(owner),
        json={"action": "apply"},
    )
    assert second.status_code == 409
    assert second.json()["code"] == "edit_not_pending"


# ─────────────────────────────────────────────────────────────────────────────
# Regression: Từ chối không được làm mất tài liệu
# ─────────────────────────────────────────────────────────────────────────────
def test_tu_choi_van_giu_tep_va_kiem_ke_vung(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Version Từ chối không đổi nội dung, nên phải trỏ vào ĐÚNG tệp cũ.

    Trước khi sửa, nó ghi `file_id = NULL`; "version hiện tại" thành một snapshot
    rỗng và kéo theo cả dây: `fields` về rỗng trên UI, `save_fields()` ném
    `missing_file`, bình luận mồ côi hàng loạt. Nghĩa là **Purchasing bị Từ chối
    xong thì không sửa được gì** — hỏng đúng bước quan trọng nhất của vòng lặp.
    """
    rid = review["id"]
    field_count = len([f for f in review["fields"] if not f["locked"]])
    assert field_count > 0, "corpus phải có vùng mở ghi được"

    submitted = client.post(f"/api/v1/reviews/{rid}/submit", headers=_h(owner))
    assert submitted.status_code == 200, submitted.text

    rejected = client.post(
        f"/api/v1/reviews/{rid}/legal-decision",
        headers=_h(legal),
        json={"decision": "reject", "comment": "Đề nghị chỉnh Điều 4"},
    )
    assert rejected.status_code == 200, rejected.text
    body = rejected.json()
    assert body["status"] == "rejected"

    still_editable = [f for f in body["fields"] if not f["locked"]]
    assert len(still_editable) == field_count, "Từ chối không được làm mất vùng mở nào"

    # Và Purchasing phải ghi được ngay sau đó — đó là cả mục đích của việc Từ chối
    target = still_editable[0]
    saved = client.put(
        f"/api/v1/reviews/{rid}/fields",
        headers=_h(owner),
        json={"fields": [{"id": target["id"], "value": (target["value"] or "") + " sửa"}]},
    )
    assert saved.status_code == 200, saved.text


def test_gui_lai_cung_doan_thi_ghi_de_ban_dang_treo(
    client: TestClient, legal: str, review: dict
):
    """Người duyệt chỉnh lại góp ý của mình — không được đẻ ra bản thứ hai."""
    rid = review["id"]
    anchor, field = _open_anchor(client, legal, review)

    def send(suffix: str) -> list[dict]:
        r = client.post(
            f"/api/v1/reviews/{rid}/legal-edits",
            headers=_h(legal),
            json={
                "edits": [
                    {
                        "paraId": anchor["paraId"],
                        "kind": "replace",
                        "before": anchor["text"],
                        "after": anchor["text"].replace(
                            field["value"], field["value"] + suffix, 1
                        ),
                    }
                ]
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    send(" lần một")
    second = send(" lần hai")
    mine = [e for e in second if e["paraId"] == anchor["paraId"] and e["status"] == "pending"]
    assert len(mine) == 1, "chỉ được MỘT đề xuất đang treo cho mỗi đoạn × người đề xuất"
    assert mine[0]["addedText"] == " lần hai"


def test_de_xuat_lai_duoc_sau_khi_ban_truoc_da_duoc_quyet(
    client: TestClient, legal: str, owner: str, review: dict
):
    """
    Vòng review sau, người duyệt góp ý lại chính đoạn đó.

    Đây là lý do ràng buộc duy nhất phải là **partial index chỉ trên `pending`**.
    UNIQUE thường sẽ nuốt góp ý mới trong im lặng — người duyệt bấm Gửi, thấy
    "đã gửi", mà chẳng có gì được ghi.
    """
    rid = review["id"]
    anchor, field = _open_anchor(client, legal, review)

    def send(suffix: str) -> dict:
        r = client.post(
            f"/api/v1/reviews/{rid}/legal-edits",
            headers=_h(legal),
            json={
                "edits": [
                    {
                        "paraId": anchor["paraId"],
                        "kind": "replace",
                        "before": anchor["text"],
                        "after": anchor["text"].replace(
                            field["value"], field["value"] + suffix, 1
                        ),
                    }
                ]
            },
        )
        assert r.status_code == 201, r.text
        return next(
            e for e in r.json() if e["paraId"] == anchor["paraId"] and e["status"] == "pending"
        )

    first = send(" vòng 1")
    dismissed = client.post(
        f"/api/v1/reviews/{rid}/legal-edits/{first['id']}/decide",
        headers=_h(owner),
        json={"action": "reject"},
    )
    assert dismissed.status_code == 200, dismissed.text

    second = send(" vòng 2")
    assert second["id"] != first["id"], "phải là một bản ghi MỚI, không phải ghi đè lịch sử"
    assert second["addedText"] == " vòng 2"


def test_nguoi_duyet_khac_khong_bo_duoc_de_xuat_cua_dong_nghiep(
    client: TestClient, legal: str, review: dict
):
    """
    `apply` có `save_fields()` chặn phía dưới, `reject` thì KHÔNG có lớp nào —
    nên quyền phải kiểm ngay tại chỗ. Manager và Legal nhìn nhận một điều khoản
    khác nhau là thông tin cần giữ, không phải xung đột cần dọn.
    """
    rid = review["id"]
    anchor = _locked_anchor(client, legal, review)
    created = client.post(
        f"/api/v1/reviews/{rid}/legal-edits",
        headers=_h(legal),
        json={
            "edits": [
                {
                    "paraId": anchor["paraId"],
                    "kind": "replace",
                    "before": anchor["text"],
                    "after": anchor["text"] + " Ý kiến Legal.",
                }
            ]
        },
    )
    assert created.status_code == 201, created.text
    edit = next(e for e in created.json() if e["paraId"] == anchor["paraId"])

    manager = _token(client, "manager.pur")
    denied = client.post(
        f"/api/v1/reviews/{rid}/legal-edits/{edit['id']}/decide",
        headers=_h(manager),
        json={"action": "reject"},
    )
    assert denied.status_code in (403, 404), denied.text
