"""
B5 — PT3: tải về sửa bằng Word rồi upload lại.

Ràng buộc **C-4** nói riêng về đường này: phát hiện vùng khoá bị sửa hoặc mất
`permStart` thì **chặn hoàn toàn, không có cơ chế override**. Bộ này chứng minh
đúng điều đó bằng cách dựng lại hai cuộc tấn công thật trên OOXML:

  1. sửa nội dung một đoạn KHOÁ, giữ nguyên mọi thứ khác
  2. gỡ sạch `permStart`/`permEnd` + `documentProtection` — tức "gỡ Restrict
     Editing bằng Word", kịch bản mà structural binding sinh ra để vá

Và chứng minh đường hợp lệ vẫn chạy: sửa đúng một vùng mở thì nhận, mở **vòng
review mới** (version tăng, kết quả AI cũ bị xoá).
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from tests.conftest import corpus_path

pytestmark = pytest.mark.integration

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
W14_PARA_ID = "{http://schemas.microsoft.com/office/word/2010/wordml}paraId"


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
                "title": "Ticket PT3",
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


# ─────────────────────────────────────────────────────────────────────────────
# Dựng tệp đã bị can thiệp
# ─────────────────────────────────────────────────────────────────────────────
def _load(review: dict):
    """Bytes + bản kiểm kê của tệp ticket đang giữ."""
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
    return blob, OoxmlReader().read(DocxPackage.load(blob))


def _rewrite(blob: bytes, mutate) -> bytes:
    from app.services.document.ooxml import DOCUMENT_PART, DocxPackage
    from app.services.document.writer_common import find_body

    pkg = DocxPackage.load(blob)
    mutate(find_body(pkg.tree(DOCUMENT_PART)))
    pkg.mark_dirty(DOCUMENT_PART)
    return pkg.to_bytes()


def _touch_locked(blob: bytes, inventory) -> bytes:
    """Sửa nội dung một đoạn khoá — cuộc tấn công tinh vi hơn."""
    target = next(
        p for p in inventory.locked_paragraphs if len(p.text.strip()) > 60 and p.para_id
    )

    def mutate(body):
        for para in body.iter(f"{W}p"):
            if para.get(W14_PARA_ID) != target.para_id:
                continue
            for node in para.iter(f"{W}t"):
                if (node.text or "").strip():
                    node.text = (node.text or "") + " (BỊ SỬA)"
                    return
        raise AssertionError("không tìm thấy đoạn khoá để sửa")

    return _rewrite(blob, mutate)


def _strip_protection(blob: bytes) -> bytes:
    """Gỡ sạch perm range + documentProtection — "gỡ Restrict Editing"."""

    def mutate(body):
        removed = 0
        for node in list(body.iter()):
            if node.tag in (f"{W}permStart", f"{W}permEnd"):
                node.getparent().remove(node)
                removed += 1
        assert removed > 0, "tệp gốc phải có perm range"

    return _rewrite(blob, mutate)


def _edit_open_region(blob: bytes, perm_id: str) -> bytes:
    """Sửa đúng một chữ BÊN TRONG một vùng mở — đường hợp lệ."""

    def mutate(body):
        active = False
        for node in body.iter():
            if node.tag == f"{W}permStart" and node.get(f"{W}id") == perm_id:
                active = True
            elif node.tag == f"{W}permEnd" and node.get(f"{W}id") == perm_id:
                active = False
            elif active and node.tag == f"{W}t" and (node.text or "").strip():
                node.text = (node.text or "") + " PT3"
                return
        raise AssertionError(f"không tìm thấy w:t trong vùng {perm_id}")

    return _rewrite(blob, mutate)


def _send(client: TestClient, token: str, review_id: str, blob: bytes, note: str = ""):
    return client.post(
        f"/api/v1/reviews/{review_id}/reupload",
        headers=_h(token),
        data={"note": note},
        files={"file": ("sua-offline.docx", blob, "application/octet-stream")},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Chặn
# ─────────────────────────────────────────────────────────────────────────────
def test_sua_doan_khoa_thi_bi_chan_hoan_toan(client: TestClient, owner: str, review: dict):
    """
    Không có tham số nào bỏ qua được kiểm tra này — đó là toàn bộ nội dung C-4.

    Đây là ca khó hơn "gỡ Restrict Editing": cấu trúc còn nguyên, chỉ nội dung
    một đoạn khoá đổi. Bắt được nó nghĩa là hash từng đoạn đang thật sự chạy,
    không phải chỉ đếm số vùng.
    """
    blob, inventory = _load(review)
    r = _send(client, owner, review["id"], _touch_locked(blob, inventory))

    assert r.status_code == 422, r.text
    body = r.json()
    assert body["code"] == "reupload_rejected"
    assert any(i["type"] == "locked_region_modified" for i in body["issues"]), body["issues"]

    issue = next(i for i in body["issues"] if i["type"] == "locked_region_modified")
    # camelCase, không phải snake_case: FE đọc `diffPreview`
    assert issue.get("diffPreview"), issue
    assert "BỊ SỬA" in issue["diffPreview"]


def test_go_restrict_editing_thi_bi_chan(client: TestClient, owner: str, review: dict):
    """
    Kịch bản mà structural binding sinh ra để vá: không còn `permStart` nào thì
    hệ thống sẽ coi TOÀN BỘ tài liệu là vùng mở nếu không kiểm gì.
    """
    blob, _ = _load(review)
    r = _send(client, owner, review["id"], _strip_protection(blob))

    assert r.status_code == 422, r.text
    body = r.json()
    types = {i["type"] for i in body["issues"]}
    assert types & {"mechanism_mismatch", "count_mismatch"}, body["issues"]


def test_moi_lan_bi_chan_deu_vao_audit_log(client: TestClient, owner: str, review: dict):
    """
    Bằng chứng có người cố sửa vùng khoá phải sống sót qua `raise`.

    `write_audit()` thường ghi vào session của request, mà request kết thúc bằng
    exception nên `get_session()` rollback — xoá luôn audit. Đo được: sau hai lần
    bị chặn, bảng `audit_log` có 0 dòng. Nên đường này dùng
    `write_audit_now()` với transaction riêng.
    """
    from sqlalchemy import select

    from app.infra.db import get_session
    from app.infra.models import AuditLog

    blob, inventory = _load(review)
    assert _send(client, owner, review["id"], _touch_locked(blob, inventory)).status_code == 422

    db = next(get_session())
    rows = list(
        db.execute(
            select(AuditLog).where(
                AuditLog.action == "reupload_rejected",
                AuditLog.entity_id == review["id"],
            )
        ).scalars()
    )
    assert rows, "lần bị chặn không để lại dấu vết nào"
    assert rows[0].new_value["types"] == ["locked_region_modified"]


def test_nguoi_duyet_khong_upload_lai_duoc(client: TestClient, legal: str, review: dict):
    """
    Người duyệt sửa offline thì đi đường TH3 — đính kèm vào lượt Từ chối.

    Cho họ thay thẳng tệp của ticket là mất dấu ai đã đổi cái gì.
    """
    blob, inventory = _load(review)
    perm_id = next(f.perm_id for f in inventory.fields if f.writable and f.inner_text.strip())
    r = _send(client, legal, review["id"], _edit_open_region(blob, perm_id))
    assert r.status_code == 422
    assert r.json()["code"] == "not_owner"


def test_khong_nhan_tep_khong_phai_docx(client: TestClient, owner: str, review: dict):
    r = client.post(
        f"/api/v1/reviews/{review['id']}/reupload",
        headers=_h(owner),
        files={"file": ("hopdong.pdf", b"%PDF-1.7 fake", "application/pdf")},
    )
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_file_type"


# ─────────────────────────────────────────────────────────────────────────────
# Đường hợp lệ
# ─────────────────────────────────────────────────────────────────────────────
def test_sua_dung_vung_mo_thi_mo_vong_review_moi(
    client: TestClient, owner: str, review: dict
):
    """
    PT3 hợp lệ = **vòng review mới**, không phải một lần lưu.

    Version tăng, `field_diff` chỉ ra đúng vùng đã đổi, và ticket quay lại hàng
    chờ AI. Kết quả AI cũ bị xoá vì chúng nói về một tệp không còn tồn tại.
    """
    blob, inventory = _load(review)
    field = next(f for f in inventory.fields if f.writable and f.inner_text.strip())

    r = _send(
        client,
        owner,
        review["id"],
        _edit_open_region(blob, field.perm_id),
        note="Sửa số hợp đồng theo yêu cầu Legal",
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["version"] == review["version"] + 1
    assert body["status"] in ("queued", "processing", "reviewed")

    written = next(f for f in body["fields"] if f["id"] == field.perm_id)
    assert written["value"].endswith(" PT3"), written["value"]

    entry = body["versionHistory"][-1]
    assert entry["action"] == "reupload"
    assert entry["label"] == "Sửa số hợp đồng theo yêu cầu Legal"
    diff = entry["fieldDiff"]
    assert len(diff) == 1, diff
    assert diff[0]["permId"] == field.perm_id
    assert diff[0]["new"].endswith(" PT3")
