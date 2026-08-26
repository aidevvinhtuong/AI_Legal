"""
B2 — ràng buộc cấu trúc template. Vá lỗ hổng của Blueprint (CLAUDE.md 5.1).

Bài quan trọng nhất: **kịch bản tấn công thật phải bị chặn**.

    Purchasing tải template về → gỡ Restrict Editing bằng Word → upload lên.
    Nếu hệ thống nhận, nó thấy 0 permStart ⇒ coi TOÀN BỘ tài liệu là vùng mở ⇒
    AI được phép ghi đè khung pháp lý. Mô hình an toàn sụp đổ.

Ở đây "gỡ Restrict Editing" mô phỏng bằng cách xoá `w:documentProtection` và
toàn bộ `permStart`/`permEnd` khỏi `word/document.xml` — đúng thứ Word làm khi
người dùng bấm Stop Protection rồi lưu lại.
"""

from __future__ import annotations

import io
import json
import re
import zipfile

import pytest
from fastapi.testclient import TestClient

from tests.conftest import corpus_path

pytestmark = pytest.mark.integration

# Loại HĐ riêng cho bộ test này, để không đụng template của bộ khác
SLUG = "cn_log_log_inland"


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


def _strip_protection(blob: bytes) -> bytes:
    """Mô phỏng Word bấm «Stop Protection» rồi lưu lại."""
    buf = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(blob)) as src,
        zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst,
    ):
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "word/settings.xml":
                data = re.sub(rb"<w:documentProtection[^>]*/>", b"", data)
            elif info.filename == "word/document.xml":
                data = re.sub(rb"<w:perm(Start|End)[^>]*/>", b"", data)
            dst.writestr(info.filename, data)
    return buf.getvalue()


@pytest.fixture(scope="module")
def registered(client: TestClient, legal: str) -> dict:
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/templates",
            headers=_h(legal),
            data={"contract_name_id": SLUG},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    return r.json()


# ─────────────────────────────────────────────────────────────────────────────
# Đăng ký template
# ─────────────────────────────────────────────────────────────────────────────
def test_dang_ky_template_ghi_lai_du_cau_truc(registered: dict):
    assert registered["mechanism"] == "permission_range"
    assert registered["protectionEffective"] is True
    assert registered["openRegionCount"] > 0
    assert registered["lockedFingerprint"] and registered["structureFingerprint"]
    assert registered["lockedParagraphCount"] > 0
    assert len(registered["regions"]) == registered["openRegionCount"]


def test_dang_ky_lai_thi_bump_version_va_tat_ban_cu(
    client: TestClient, legal: str, registered: dict
):
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        again = client.post(
            "/api/v1/templates",
            headers=_h(legal),
            data={"contract_name_id": SLUG},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert again.status_code == 201, again.text
    assert again.json()["version"] == registered["version"] + 1

    rows = client.get(f"/api/v1/templates?contract_name_id={SLUG}", headers=_h(legal)).json()
    active = [r for r in rows if r["isActive"]]
    assert len(active) == 1, "chỉ một bản được hiệu lực"
    assert active[0]["version"] == again.json()["version"]
    assert len(rows) >= 2, "bản cũ KHÔNG được xoá — review đang chạy vẫn trỏ vào nó"


def test_template_khong_co_restrict_editing_bi_tu_choi(client: TestClient, legal: str):
    """Nhận vào rồi mới phát hiện thì mọi file sinh từ nó đều coi cả tài liệu là mở."""
    blob = _strip_protection(corpus_path("hddv").read_bytes())
    r = client.post(
        "/api/v1/templates",
        headers=_h(legal),
        data={"contract_name_id": "cn_mro_mro_maint"},
        files={"file": ("hong.docx", blob, "application/octet-stream")},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "structural_binding_failed"
    types = {i["type"] for i in r.json()["issues"]}
    assert {"no_open_region", "protection_removed"} & types


def test_lint_khong_luu_gi(client: TestClient, legal: str):
    path = corpus_path("thaco")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/templates/lint",
            headers=_h(legal),
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mechanism"] == "permission_range"
    assert body["openRegionCount"] == 16, "hợp đồng THACO có 16 vùng mở (khảo sát F1)"
    assert body["regions"], "Legal cần thấy từng vùng để đặt tên nghiệp vụ"

    rows = client.get("/api/v1/templates", headers=_h(legal)).json()
    assert not [x for x in rows if x["fileName"] == path.name], "lint không được lưu gì"


def test_dat_ten_nghiep_vu_cho_vung_mo(client: TestClient, legal: str, registered: dict):
    """
    `permId` của Range Permission là số nguyên ngẫu nhiên không tên (PH-2).
    Không có bảng ánh xạ thì UI chỉ hiện được "Vùng mở #7".
    """
    rows = client.get(f"/api/v1/templates?contract_name_id={SLUG}", headers=_h(legal)).json()
    active = next(x for x in rows if x["isActive"])
    perm_id = active["regions"][0]["permId"]

    r = client.put(
        f"/api/v1/templates/{active['id']}/field-labels",
        headers=_h(legal),
        json={"labels": {perm_id: "Số hợp đồng"}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["regions"][0]["label"] == "Số hợp đồng"

    bad = client.put(
        f"/api/v1/templates/{active['id']}/field-labels",
        headers=_h(legal),
        json={"labels": {"9999999999": "Không tồn tại"}},
    )
    assert bad.status_code == 422
    assert bad.json()["code"] == "unknown_perm_id"


def test_purchasing_khong_dang_ky_duoc_template(client: TestClient, owner: str):
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/templates",
            headers=_h(owner),
            data={"contract_name_id": SLUG},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 403


# ─────────────────────────────────────────────────────────────────────────────
# Đường CHÍNH — sinh từ template
# ─────────────────────────────────────────────────────────────────────────────
def _intake(slug: str = SLUG) -> str:
    return json.dumps(
        {
            "documentCategoryId": "log",
            "businessEntityId": "be_vts",
            "contractNameId": slug,
            "contractValue": "500000000",
        }
    )


def test_sinh_tu_template_khong_can_upload(client: TestClient, owner: str, registered: dict):
    del registered
    r = client.post(
        "/api/v1/reviews",
        headers=_h(owner),
        data={"title": "Sinh từ template", "from_template": "true", "intake": _intake()},
    )
    assert r.status_code == 201, r.text
    body = r.json()

    binding = body["intake"]["structuralBinding"]
    assert binding["status"] == "instantiated"
    assert binding["templateVersion"] >= 1
    assert body["fields"], "phải kiểm kê được vùng mở"


def test_sinh_tu_template_ke_thua_ten_nghiep_vu(client: TestClient, owner: str, legal: str):
    """Nhãn Legal khai lúc đăng ký phải đi theo vào từng version của ticket."""
    rows = client.get(f"/api/v1/templates?contract_name_id={SLUG}", headers=_h(legal)).json()
    active = next(x for x in rows if x["isActive"])
    perm_id = active["regions"][0]["permId"]
    client.put(
        f"/api/v1/templates/{active['id']}/field-labels",
        headers=_h(legal),
        json={"labels": {perm_id: "Số hợp đồng"}},
    )

    body = client.post(
        "/api/v1/reviews",
        headers=_h(owner),
        data={"title": "Có nhãn", "from_template": "true", "intake": _intake()},
    ).json()
    labelled = {f["id"]: f["label"] for f in body["fields"]}
    assert labelled.get(perm_id) == "Số hợp đồng"


def test_sinh_tu_template_khi_chua_dang_ky_thi_chan(client: TestClient, owner: str):
    r = client.post(
        "/api/v1/reviews",
        headers=_h(owner),
        data={
            "title": "Chưa có template",
            "from_template": "true",
            "intake": _intake("cn_capex_capex_vehicle"),
        },
    )
    assert r.status_code == 409
    assert r.json()["code"] == "template_not_registered"


# ─────────────────────────────────────────────────────────────────────────────
# Đường PHỤ — upload, bắt buộc qua binding
# ─────────────────────────────────────────────────────────────────────────────
def test_upload_dung_template_thi_qua(client: TestClient, owner: str, registered: dict):
    del registered
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={"title": "Upload khớp", "intake": _intake()},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    assert r.json()["intake"]["structuralBinding"]["status"] == "bound"


def test_go_restrict_editing_roi_upload_bi_chan(client: TestClient, owner: str, registered: dict):
    """
    ★ Kịch bản tấn công của CLAUDE.md 5.1. Đây là lý do tồn tại của cả module.

    Trước B2, file này đi thẳng vào queue và AI được phép ghi đè điều khoản pháp
    lý vì hệ thống thấy 0 permStart ⇒ coi cả tài liệu là vùng mở.
    """
    del registered
    blob = _strip_protection(corpus_path("hddv").read_bytes())
    r = client.post(
        "/api/v1/reviews",
        headers=_h(owner),
        data={"title": "Đã gỡ khoá", "intake": _intake()},
        files={"file": ("da-go-khoa.docx", blob, "application/octet-stream")},
    )
    assert r.status_code == 422, "phải CHẶN, không có override (C-4)"
    body = r.json()
    assert body["code"] == "structural_binding_failed"
    types = {i["type"] for i in body["issues"]}
    assert types & {"protection_removed", "mechanism_mismatch", "count_mismatch"}, types


def test_upload_file_khac_han_bi_chan(client: TestClient, owner: str, registered: dict):
    """File hợp lệ về định dạng nhưng KHÔNG phải template của loại HĐ này."""
    del registered
    path = corpus_path("thaco")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={"title": "Sai template", "intake": _intake()},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 422
    assert r.json()["code"] == "structural_binding_failed"
    assert r.json()["issues"], "phải nói rõ sai ở đâu để Purchasing tự sửa"


def test_loai_hd_chua_co_template_thi_qua_nhung_bao_ro(client: TestClient, owner: str):
    """
    Không thể bắt mọi loại HĐ phải có template ngay ngày đầu. Nhưng KHÔNG được
    im lặng: người duyệt phải biết tài liệu này chưa ràng buộc cấu trúc.
    """
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={"title": "Chưa có template", "intake": _intake("cn_raw_raw_gypsum")},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    binding = r.json()["intake"]["structuralBinding"]
    assert binding["status"] == "unbound"
    assert "chưa có template" in binding["reason"].lower()


def test_khoa_checklist_lay_tu_ten_hop_dong_khong_phai_loai_gia_tri(client: TestClient, owner: str):
    """
    Bẫy đã gặp thật: form «Tạo tài liệu» của FE gửi `contract_type_id =
    ct_standard` ("Loại giá trị hợp đồng"), trong khi khoá checklist và khoá
    template là **slug Tên hợp đồng**. Ticket tạo qua UI liền tra checklist bằng
    `ct_standard`, không khớp gì, và AI chạy với checklist RỖNG mà không ai biết.
    """
    path = corpus_path("hddv")
    with path.open("rb") as fh:
        r = client.post(
            "/api/v1/reviews",
            headers=_h(owner),
            data={
                "title": "Gửi kèm contract_type_id sai",
                "contract_type_id": "ct_standard",
                "intake": _intake("cn_raw_raw_gypsum"),
            },
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert r.status_code == 201, r.text
    assert r.json()["contractTypeId"] == "cn_raw_raw_gypsum", (
        "phải lấy Tên hợp đồng từ intake, không phải Loại giá trị hợp đồng"
    )


def test_ten_nghiep_vu_song_sot_qua_cac_lan_ghi(client: TestClient, owner: str, legal: str):
    """
    Nhãn vùng chỉ được đặt lúc đăng ký template. Nếu không kế thừa sang version
    sau thì ghi trường MỘT lần là mọi vùng quay về "Vùng mở #7": UI mất tên, và
    chat mất luôn khả năng nhận ra người dùng đang nói tới vùng nào.
    """
    rows = client.get(f"/api/v1/templates?contract_name_id={SLUG}", headers=_h(legal)).json()
    active = next(x for x in rows if x["isActive"])
    perm_id = active["regions"][0]["permId"]
    client.put(
        f"/api/v1/templates/{active['id']}/field-labels",
        headers=_h(legal),
        json={"labels": {perm_id: "Số hợp đồng"}},
    )

    created = client.post(
        "/api/v1/reviews",
        headers=_h(owner),
        data={"title": "Giữ nhãn", "from_template": "true", "intake": _intake()},
    ).json()
    assert next(f for f in created["fields"] if f["id"] == perm_id)["label"] == "Số hợp đồng"

    writable = next(f for f in created["fields"] if f["regionKind"] == "atomic_field")
    after = client.put(
        f"/api/v1/reviews/{created['id']}/fields",
        headers=_h(owner),
        json={"fields": [{"id": writable["id"], "value": "GIÁ TRỊ MỚI"}]},
    ).json()

    assert after["version"] > created["version"]
    assert next(f for f in after["fields"] if f["id"] == perm_id)["label"] == "Số hợp đồng", (
        "nhãn phải sống sót qua lần ghi"
    )


def test_dang_ky_lai_thi_ke_thua_ten_nghiep_vu(client: TestClient, legal: str):
    """
    Legal sửa template rồi tải lên lại là chuyện thường. Không kế thừa nhãn thì
    mỗi lần như vậy là mất sạch tên nghiệp vụ đã đặt, và mọi vùng quay về
    "Vùng mở #7" — gặp thật khi người dùng test trên UI.
    """
    rows = client.get(f"/api/v1/templates?contract_name_id={SLUG}", headers=_h(legal)).json()
    active = next(x for x in rows if x["isActive"])
    perm_id = active["regions"][0]["permId"]
    client.put(
        f"/api/v1/templates/{active['id']}/field-labels",
        headers=_h(legal),
        json={"labels": {perm_id: "Số hợp đồng"}},
    )

    path = corpus_path("hddv")
    with path.open("rb") as fh:
        again = client.post(
            "/api/v1/templates",
            headers=_h(legal),
            data={"contract_name_id": SLUG},
            files={"file": (path.name, fh, "application/octet-stream")},
        )
    assert again.status_code == 201, again.text
    body = again.json()
    assert body["fieldLabels"].get(perm_id) == "Số hợp đồng", "nhãn phải theo sang bản mới"
    assert next(r for r in body["regions"] if r["permId"] == perm_id)["label"] == "Số hợp đồng"
