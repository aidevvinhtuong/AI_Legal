"""
Client cho LLM (endpoint tương thích OpenAI).

Ba điều BẮT BUỘC ở mọi lần gọi, đã kiểm chứng bằng `scripts/check-llm.py`:

  1. `chat_template_kwargs: {"enable_thinking": false}` — không tắt thì Qwen3
     sinh khối `<think>` rất dài và chậm.
  2. `temperature: 0` cho mọi stage phán xét — cùng đầu vào phải ra cùng kết luận.
  3. Guided JSON bằng `response_format: {"type": "json_schema", ...}` — KHÔNG
     parse JSON bằng regex, không "hy vọng model trả đúng định dạng".

Dùng `httpx` trực tiếp chứ không dùng SDK `openai`: ta cần kiểm soát
`chat_template_kwargs` (ngoài chuẩn OpenAI) và endpoint embedding/rerank là TEI
native, không theo chuẩn đó.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.domain.errors import UpstreamError
from app.infra.settings import get_settings

log = logging.getLogger("ailegal.llm")


@dataclass
class ChatResult:
    """Kết quả một lần gọi, kèm đủ số liệu để ghi `ai_runs` (truy vết được)."""

    content: str
    data: dict[str, Any] | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    model: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


class LlmClient:
    def __init__(self, *, timeout: float | None = None) -> None:
        s = get_settings()
        self._base = s.LLM_BASE_URL
        self._model = s.LLM_MODEL
        self._key = s.LLM_API_KEY
        self._timeout = timeout or s.LLM_TIMEOUT
        self._retries = s.LLM_MAX_RETRIES
        self._enable_thinking = s.LLM_ENABLE_THINKING
        self._seed = s.LLM_SEED

    @property
    def model(self) -> str:
        return self._model

    def model_fingerprint(self) -> str:
        """
        Vân tay của endpoint tại thời điểm chạy.

        Endpoint là dịch vụ dùng chung, không do ta vận hành. Nếu bên kia đổi
        model dưới cùng một tên thì đây là dấu vết duy nhất phát hiện được
        (TS-12 mục II.1) — ghi vào `ai_runs.model_hash`.
        """
        import hashlib

        try:
            with httpx.Client(timeout=10) as client:
                r = client.get(f"{self._base}/models", headers=self._headers())
                r.raise_for_status()
                body = json.dumps(r.json(), sort_keys=True)
        except Exception as e:
            log.warning("không lấy được /models: %s", e)
            return ""
        return hashlib.sha256(body.encode()).hexdigest()[:16]

    def chat(
        self,
        *,
        system: str,
        user: str,
        json_schema: dict[str, Any] | None = None,
        schema_name: str = "output",
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> ChatResult:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": self._enable_thinking},
        }
        if temperature == 0:
            payload["seed"] = self._seed
        if json_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": json_schema},
            }

        started = time.monotonic()
        body = self._post("/chat/completions", payload)
        latency = int((time.monotonic() - started) * 1000)

        try:
            content = body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError) as e:
            raise UpstreamError("LLM", f"Phản hồi thiếu nội dung: {body}") from e

        usage = body.get("usage") or {}
        result = ChatResult(
            content=content,
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            latency_ms=latency,
            model=str(body.get("model") or self._model),
            raw=body,
        )

        if json_schema is not None:
            try:
                # `strict=False` cho phép ký tự điều khiển THÔ bên trong chuỗi.
                # Guided decoding vẫn để lọt xuống dòng thật trong `new_text` khi
                # đề xuất là văn bản nhiều dòng, và `json.loads` mặc định từ chối
                # — mất cả lượt chat vì một dấu xuống dòng. Đo được trên máy dev:
                # "Invalid control character at line 6 column 61".
                result.data = json.loads(content, strict=False)
            except json.JSONDecodeError as e:
                # Guided decoding lẽ ra ngăn được; nếu vẫn xảy ra thì đó là lỗi
                # hạ tầng, không phải lỗi nội dung — để tầng trên rơi xuống fallback.
                raise UpstreamError("LLM", f"Guided JSON trả về không hợp lệ: {e}") from e

        return result

    # ── Nội bộ ────────────────────────────────────────────────────────────
    def _headers(self) -> dict[str, str]:
        # Header Authorization BẮT BUỘC gửi dù server không kiểm giá trị
        return {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"}

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        last: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                with httpx.Client(timeout=self._timeout) as client:
                    r = client.post(f"{self._base}{path}", json=payload, headers=self._headers())
                    if r.status_code >= 500:
                        raise httpx.HTTPStatusError(
                            f"HTTP {r.status_code}", request=r.request, response=r
                        )
                    r.raise_for_status()
                    return r.json()
            except (httpx.HTTPError, json.JSONDecodeError) as e:
                last = e
                if attempt < self._retries:
                    # Backoff tuyến tính là đủ: hàng đợi FIFO, không có bão request
                    time.sleep(1.5 * (attempt + 1))
                    log.warning("gọi LLM lỗi (lần %d): %s", attempt + 1, e)
        raise UpstreamError("LLM", f"Không gọi được sau {self._retries + 1} lần: {last}")
