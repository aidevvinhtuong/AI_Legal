"""
Client HTTP tới FPT.eContract + adapter mock.

**Chưa có credentials môi trường Demo** (câu hỏi mở D1e). Thay vì chặn cả
milestone để chờ, tầng này có hai implementation sau cùng một giao diện:

  - `FptEcontractClient` — gọi thật, dùng khi settings có đủ 4 giá trị.
  - `MockEcontractClient` — sinh `envelopeId` xác định được, dùng khi chưa có.

Nhờ vậy outbox, retry, đối soát, máy trạng thái và toàn bộ test EC-01…EC-09
(trừ EC-07 cần môi trường thật) chạy được ngay bây giờ, và ngày có credentials
thì chỉ điền `.env`, không sửa dòng code nào.

Ba điểm đáng lưu ý về phía FPT:

  1. Token có `expTime`; refresh **trước** hạn chứ không đợi 401 — một lần 401
     giữa chừng là mất một lần đẩy hợp đồng.
  2. Mọi lỗi validate marker đều trả HTTP 200 với `code: 13`. Phải đọc `code`
     trong body, không tin mã HTTP.
  3. Tài liệu ghi URL huỷ là `{ROOT}/app/services/excall/api/excall` trong khi
     `ROOT` đã tận cùng bằng `/app`. Coi là lỗi typo của tài liệu và dùng chung
     đường với API tạo; cần xác nhận lại với FPT (gộp vào câu hỏi D1a).
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.infra.settings import get_settings
from app.services.econtract.errors import EcontractError, translate

log = logging.getLogger("ailegal.econtract")

LOGIN_PATH = "/v1/client-auth/login"
EXCALL_PATH = "/services/excall/api/excall"
RECIPIENT_PATH = "/services/envelope/api/external/v1/envelopes/recipient"

# Đổi token sớm hơn hạn để không rơi vào ca hết hạn ngay giữa một lần đẩy.
TOKEN_SKEW_SECONDS = 120


@dataclass(frozen=True)
class EnvelopeResult:
    """Kết quả tạo hợp đồng bên FPT."""

    envelope_id: str
    code: int = 0
    message: str = ""
    web_view: str = ""
    env_status: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


class EcontractClient(Protocol):
    def create_envelope(self, payload: dict[str, Any]) -> EnvelopeResult: ...

    def recipient_status(self, *, contact_id: str, envelope_id: str) -> dict[str, Any]: ...

    def cancel(self, *, envelope_id: str, reason: str) -> dict[str, Any]: ...


# ─────────────────────────────────────────────────────────────────────────────
# Thật
# ─────────────────────────────────────────────────────────────────────────────
class _TokenCache:
    """Token dùng chung cho mọi worker trong tiến trình; có khoá để không login trùng."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._expires_at = 0.0

    def get(self, login: Callable[[], tuple[str, float]]) -> str:
        with self._lock:
            if self._token and time.time() < self._expires_at - TOKEN_SKEW_SECONDS:
                return self._token
            self._token, self._expires_at = login()
            return self._token

    def clear(self) -> None:
        with self._lock:
            self._token = ""
            self._expires_at = 0.0


_TOKENS = _TokenCache()


class FptEcontractClient:
    def __init__(self) -> None:
        s = get_settings()
        self._base = s.ECONTRACT_BASE_URL.rstrip("/")
        self._username = s.ECONTRACT_USERNAME
        self._password = s.ECONTRACT_PASSWORD
        self._client_id = s.ECONTRACT_CLIENT_ID
        self._client_secret = s.ECONTRACT_CLIENT_SECRET
        self._cancel_selector = s.ECONTRACT_CANCEL_SELECTOR
        self._timeout = s.ECONTRACT_TIMEOUT

    # ── Xác thực ──────────────────────────────────────────────────────────
    def _login(self) -> tuple[str, float]:
        body = self._post_json(
            LOGIN_PATH,
            {
                "username": self._username,
                "password": self._password,
                "clientid": self._client_id,
                "clientsecret": self._client_secret,
            },
            token=None,
        )
        token = str(body.get("access_token") or body.get("accessToken") or "")
        if not token:
            raise EcontractError(
                "FPT.eContract không trả access_token", code="loginFailed", retryable=True
            )
        # `expTime` có thể là epoch giây, epoch mili, hoặc số giây còn lại.
        raw_exp = body.get("expTime") or body.get("expiresIn") or 0
        return token, _normalise_expiry(raw_exp)

    def _token(self) -> str:
        return _TOKENS.get(self._login)

    # ── API ───────────────────────────────────────────────────────────────
    def create_envelope(self, payload: dict[str, Any]) -> EnvelopeResult:
        body = self._post_json(EXCALL_PATH, payload, token=self._token())
        code = _as_int(body.get("code"))
        if code:
            message = str(body.get("message") or "")
            raise EcontractError(
                translate(message, fallback=message),
                code=message or str(code),
                # code 13 = lỗi dữ liệu (marker/recipient). Thử lại vô nghĩa.
                retryable=code != 13,
                detail={"httpBody": _shallow(body)},
            )

        envelope_id = _dig(body, "envelopeId") or _dig(body, "envelopeID")
        if not envelope_id:
            raise EcontractError(
                "FPT.eContract nhận yêu cầu nhưng không trả envelopeId",
                code="missingEnvelopeId",
                retryable=True,
                detail={"httpBody": _shallow(body)},
            )
        return EnvelopeResult(
            envelope_id=str(envelope_id),
            code=code,
            message=str(body.get("message") or ""),
            web_view=str(_dig(body, "webView") or ""),
            env_status=str(_dig(body, "envStatus") or "Processing"),
            raw=_shallow(body),
        )

    def recipient_status(self, *, contact_id: str, envelope_id: str) -> dict[str, Any]:
        return self._post_json(
            RECIPIENT_PATH,
            {"contactId": contact_id, "envelopeId": envelope_id},
            token=self._token(),
        )

    def cancel(self, *, envelope_id: str, reason: str) -> dict[str, Any]:
        return self._post_json(
            EXCALL_PATH,
            {
                "id": "",
                "selector": self._cancel_selector,
                "lookup": envelope_id,
                "body": {
                    "type": "sync",
                    "actList": [{"envelopeId": envelope_id, "reason": reason}],
                },
            },
            token=self._token(),
        )

    # ── Nội bộ ────────────────────────────────────────────────────────────
    def _post_json(
        self, path: str, payload: dict[str, Any], *, token: str | None
    ) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(f"{self._base}{path}", json=payload, headers=headers)
        except httpx.HTTPError as e:
            raise EcontractError(
                f"Không kết nối được FPT.eContract: {e}", code="network", retryable=True
            ) from e

        if response.status_code == 401 and token:
            _TOKENS.clear()  # token hỏng — lần thử sau sẽ login lại
            raise EcontractError(
                "Phiên đăng nhập FPT.eContract hết hạn", code="unauthorized", retryable=True
            )
        if response.status_code >= 500:
            raise EcontractError(
                f"FPT.eContract lỗi máy chủ (HTTP {response.status_code})",
                code="upstream",
                retryable=True,
            )
        if response.status_code >= 400:
            raise EcontractError(
                f"FPT.eContract từ chối yêu cầu (HTTP {response.status_code})",
                code="badRequest",
                retryable=False,
                detail={"body": response.text[:500]},
            )
        try:
            return response.json()
        except json.JSONDecodeError as e:
            raise EcontractError(
                "FPT.eContract trả về nội dung không phải JSON",
                code="badResponse",
                retryable=True,
            ) from e


# ─────────────────────────────────────────────────────────────────────────────
# Mock
# ─────────────────────────────────────────────────────────────────────────────
class MockEcontractClient:
    """
    Adapter thay thế khi chưa có credentials.

    `envelopeId` sinh từ hash của `refId` nên **xác định được**: gọi lại hai lần
    cùng một hợp đồng ra cùng một id, đúng như hành vi idempotency mong đợi của
    FPT — nhờ vậy test đối soát và test chống đẩy trùng có ý nghĩa thật.
    """

    def create_envelope(self, payload: dict[str, Any]) -> EnvelopeResult:
        ref_id = str(payload.get("refId") or "")
        if not ref_id:
            raise EcontractError(
                translate("requestNotContainsRefId"),
                code="requestNotContainsRefId",
                retryable=False,
            )
        digest = hashlib.sha256(ref_id.encode()).hexdigest()[:12].upper()
        envelope_id = f"MOCK-{digest}"
        log.info("mock eContract: tạo envelope %s cho %s", envelope_id, ref_id)
        return EnvelopeResult(
            envelope_id=envelope_id,
            message="Adapter mock — chưa cấu hình credentials FPT (câu hỏi mở D1e)",
            env_status="Processing",
            web_view="",
            raw={"mock": True},
        )

    def recipient_status(self, *, contact_id: str, envelope_id: str) -> dict[str, Any]:
        return {
            "mock": True,
            "envelopeId": envelope_id,
            "contactId": contact_id,
            "envStatus": "Processing",
            "recipientStatus": "Waiting",
            "webView": "",
        }

    def cancel(self, *, envelope_id: str, reason: str) -> dict[str, Any]:
        return {"mock": True, "envelopeId": envelope_id, "envStatus": "Voided", "reason": reason}


def get_client() -> EcontractClient:
    """Thật khi đủ credentials, mock khi chưa. Không có cờ bật/tắt thủ công."""
    return FptEcontractClient() if get_settings().econtract_configured else MockEcontractClient()


def is_mock() -> bool:
    return not get_settings().econtract_configured


# ─────────────────────────────────────────────────────────────────────────────
# Tiện ích đọc phản hồi
# ─────────────────────────────────────────────────────────────────────────────
def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _dig(node: Any, key: str, depth: int = 6) -> Any:
    """
    Tìm `key` ở bất kỳ đâu trong cây phản hồi.

    Tài liệu FPT không cố định mức lồng của `envelopeId` giữa các ví dụ; bám
    cứng một đường dẫn là hỏng ngay lần đầu chạy thật.
    """
    if depth < 0:
        return None
    if isinstance(node, dict):
        if node.get(key):
            return node[key]
        for value in node.values():
            found = _dig(value, key, depth - 1)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _dig(item, key, depth - 1)
            if found:
                return found
    return None


def _shallow(body: dict[str, Any], limit: int = 4000) -> dict[str, Any]:
    """Bản gọn để lưu DB — không giữ base64 và không phình bản ghi."""
    text = json.dumps(body, ensure_ascii=False)[:limit]
    return {"snippet": text}


def _normalise_expiry(raw: Any) -> float:
    now = time.time()
    value = float(_as_int(raw))
    if value <= 0:
        return now + 3600  # tài liệu không nói rõ — mặc định 1 giờ
    if value > 1e12:  # epoch mili
        return value / 1000
    if value > 1e9:  # epoch giây
        return value
    return now + value  # số giây còn lại


__all__ = [
    "EcontractClient",
    "EnvelopeResult",
    "FptEcontractClient",
    "MockEcontractClient",
    "get_client",
    "is_mock",
]
