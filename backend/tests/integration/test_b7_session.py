"""
B7 — phiên trượt có trần tuyệt đối.

## Vấn đề đang sửa

Token sống `ACCESS_TOKEN_MINUTES` (30) tính từ lúc **đăng nhập**, không phải từ
thao tác cuối, và không có đường gia hạn nào — `REFRESH_TOKEN_HOURS` là cấu hình
khai ra rồi không đọc. Người dùng đang gõ dở cũng bị đá ra ở phút thứ 31.

Cái đắt nhất không phải sự phiền toái: quy tắc **A4c** bắt lưu thủ công cho mọi
chỉnh sửa, nên bị đá ra giữa chừng là **mất trắng phần chưa lưu**.

## Hai thứ bộ này phải chứng minh cùng lúc

1. Người **đang làm việc** không bao giờ bị ngắt — gia hạn được bao nhiêu lần
   tuỳ ý, mỗi lần đẩy hạn token xa thêm.
2. Phiên **không bao giờ trượt vô hạn** — quá `REFRESH_TOKEN_HOURS` kể từ lần
   nhập mật khẩu gốc là chặn, dù token hiện tại còn hiệu lực.

Điều thứ hai mới là điều dễ làm hỏng: chỉ cần `lgn` bị cấp lại theo thời điểm
hiện tại ở mỗi lần gia hạn là trần biến mất, mà mọi test "gia hạn được" vẫn xanh.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

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


def _login(client: TestClient, username: str = "thi.b") -> dict:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": "demo123"})
    assert r.status_code == 200, r.text
    return r.json()


def _claims(token: str) -> dict:
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ─────────────────────────────────────────────────────────────────────────────
# Người đang làm việc không bị ngắt
# ─────────────────────────────────────────────────────────────────────────────
def test_gia_han_day_han_xa_them_va_khong_bao_gio_ngan_lai(client: TestClient):
    """
    Kiểm **ngữ nghĩa**, không kiểm chuỗi token có khác nhau không.

    JWT là tất định: cùng payload ra cùng chuỗi. `iat`/`exp` tính bằng giây, nên
    đăng nhập rồi gia hạn ngay trong cùng một giây sẽ trả về **đúng chuỗi cũ** —
    hoàn toàn vô hại (hạn của nó vẫn là 30 phút kể từ bây giờ), nhưng một phép
    kiểm `token != token_cũ` sẽ đỏ ở đây và xanh trên máy chậm hơn. Đó là test
    hỏng, không phải code hỏng.

    Thứ thật sự phải đúng: hạn mới **không bao giờ gần hơn** hạn cũ.
    """
    session = _login(client)
    before = _claims(session["token"])

    r = client.post("/api/v1/auth/refresh", headers=_h(session["token"]))
    assert r.status_code == 200, r.text
    after = _claims(r.json()["token"])

    assert after["exp"] >= before["exp"], "hạn phải lùi xa thêm, không được ngắn lại"
    assert after["sub"] == before["sub"]
    assert client.get("/api/v1/reviews", headers=_h(r.json()["token"])).status_code == 200


def test_token_sau_khi_gia_han_dung_duoc_ngay(client: TestClient):
    session = _login(client)
    fresh = client.post("/api/v1/auth/refresh", headers=_h(session["token"])).json()["token"]
    r = client.get("/api/v1/reviews", headers=_h(fresh))
    assert r.status_code == 200, r.text


def test_gia_han_nhieu_lan_lien_tiep_van_chay(client: TestClient):
    """Người làm việc cả buổi sẽ gia hạn hàng chục lần — không được hỏng dần."""
    token = _login(client)["token"]
    for i in range(5):
        r = client.post("/api/v1/auth/refresh", headers=_h(token))
        assert r.status_code == 200, f"vòng {i}: {r.text}"
        token = r.json()["token"]
    assert client.get("/api/v1/reviews", headers=_h(token)).status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Trần tuyệt đối — phần dễ làm hỏng nhất
# ─────────────────────────────────────────────────────────────────────────────
def test_moc_dang_nhap_goc_khong_bi_day_qua_moi_lan_gia_han(client: TestClient):
    """
    `lgn` phải **giữ nguyên** qua mọi lần gia hạn.

    Cấp lại `lgn` theo thời điểm hiện tại là làm trần phiên biến mất hoàn toàn —
    mà mọi test "gia hạn được" vẫn xanh, nên không ai phát hiện.
    """
    token = _login(client)["token"]
    origin = _claims(token)["lgn"]

    for _ in range(3):
        token = client.post("/api/v1/auth/refresh", headers=_h(token)).json()["token"]
        assert _claims(token)["lgn"] == origin, "mốc đăng nhập gốc bị đẩy — trần vô hiệu"


def test_qua_tran_thi_chan_du_token_con_hieu_luc(client: TestClient):
    """
    Token còn hạn nhưng phiên đã quá `REFRESH_TOKEN_HOURS` ⇒ không gia hạn nữa.

    Đây là ca máy trạm bỏ quên: tab vẫn mở, cơ chế giữ phiên vẫn chạy, nhưng
    phiên phải chết. Thiếu nhánh này thì "phiên trượt" thành "phiên vĩnh viễn".
    """
    import jwt
    from sqlalchemy import select

    from app.infra.db import get_session
    from app.infra.models import User
    from app.infra.settings import get_settings

    settings = get_settings()
    db = next(get_session())
    user = db.execute(select(User).where(User.username == "thi.b")).scalar_one()
    now = datetime.now(timezone.utc)

    def forge(login_hours_ago: float) -> str:
        payload = {
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
            "perms": list(user.permissions or []),
            "iat": int(now.timestamp()),
            "lgn": int((now - timedelta(hours=login_hours_ago)).timestamp()),
            # token còn hiệu lực — vấn đề nằm ở TRẦN PHIÊN, không phải hạn token
            "exp": int((now + timedelta(minutes=30)).timestamp()),
            "iss": "ai-legal",
        }
        return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    cap = settings.REFRESH_TOKEN_HOURS
    ok = client.post("/api/v1/auth/refresh", headers=_h(forge(cap - 0.1)))
    assert ok.status_code == 200, "ngay trước trần thì vẫn phải gia hạn được"

    denied = client.post("/api/v1/auth/refresh", headers=_h(forge(cap + 0.1)))
    assert denied.status_code == 401, denied.text
    assert "tối đa" in denied.json()["detail"]


# ─────────────────────────────────────────────────────────────────────────────
# Không mở đường vòng
# ─────────────────────────────────────────────────────────────────────────────
def test_khong_gia_han_duoc_khi_khong_co_token(client: TestClient):
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_khong_gia_han_duoc_bang_token_rac(client: TestClient):
    assert client.post("/api/v1/auth/refresh", headers=_h("rac.khong.hop.le")).status_code == 401


def test_tai_khoan_bi_vo_hieu_hoa_thi_khong_gia_han_duoc(client: TestClient):
    """
    Gia hạn phải đọc lại trạng thái `active` từ DB.

    Nếu chỉ tin token thì IT vô hiệu hoá một tài khoản mà phiên đang mở vẫn tự
    gia hạn được — tức lệnh khoá tài khoản không có hiệu lực cho tới hết trần.
    """
    from sqlalchemy import select

    from app.infra.db import get_session
    from app.infra.models import User

    token = _login(client, "van.a")["token"]
    db = next(get_session())
    user = db.execute(select(User).where(User.username == "van.a")).scalar_one()
    user.active = False
    db.commit()
    try:
        r = client.post("/api/v1/auth/refresh", headers=_h(token))
        assert r.status_code == 403, r.text
    finally:
        user.active = True
        db.commit()


def test_dang_nhap_tra_ve_tran_phien(client: TestClient):
    """FE cần biết mốc này để báo trước, thay vì để màn hình nhảy về /login."""
    from app.infra.settings import get_settings

    session = _login(client)
    assert session.get("sessionExpiresAt"), "login phải trả `sessionExpiresAt`"

    deadline = datetime.fromisoformat(session["sessionExpiresAt"])
    expected = datetime.now(timezone.utc) + timedelta(hours=get_settings().REFRESH_TOKEN_HOURS)
    assert abs((deadline - expected).total_seconds()) < 120
