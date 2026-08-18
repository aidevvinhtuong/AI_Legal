"""
Cổng ra ngoài của tầng AI.

`services/ai` là **thư viện thuần**: nó không được biết mình đang gọi vLLM hay
TEI, cũng không được tự mở kết nối. Nó chỉ khai báo ba giao thức dưới đây và
nhận implementation từ ngoài vào.

Nhờ vậy toàn bộ pipeline — matcher, judge, aggregator, scorer — test được offline
bằng client giả, không cần endpoint model nào sống. Đó là điều kiện để bộ test
chạy trong CI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class ChatOutput:
    """Kết quả một lần gọi LLM, đủ dữ liệu để ghi `ai_runs`."""

    content: str
    data: dict[str, Any] | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    model: str = ""


@dataclass
class UsageTally:
    """Cộng dồn chi phí của cả một lần chạy pipeline."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    errors: list[str] = field(default_factory=list)

    def add(self, out: ChatOutput) -> None:
        self.calls += 1
        self.input_tokens += out.input_tokens
        self.output_tokens += out.output_tokens
        self.latency_ms += out.latency_ms


class ChatModel(Protocol):
    def chat(
        self,
        *,
        system: str,
        user: str,
        json_schema: dict[str, Any] | None = None,
        schema_name: str = "output",
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> ChatOutput: ...

    @property
    def model(self) -> str: ...


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class Reranker(Protocol):
    def rerank(
        self, query: str, texts: list[str], *, top_n: int | None = None
    ) -> list[tuple[int, float]]: ...
