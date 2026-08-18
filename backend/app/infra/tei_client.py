"""
Client cho embedding và rerank — **TEI native API**, không phải chuẩn OpenAI.

    POST /embed    {"inputs": [...]}          → [[float, ...], ...]
    POST /rerank   {"query": ..., "texts":[]} → [{"index": i, "score": s}, ...]

Model embedding hiện tại (`AITeamVN/Vietnamese_Embedding`) **chỉ có vector
dense**, không có sparse như BGE-M3. Vì vậy tầng từ vựng của matcher dùng BM25
tính tại chỗ thay vì vector sparse (TS-12 mục II.3) — đây là thay đổi thật về
chất lượng, phải đo bằng golden set chứ không giả định tương đương.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.domain.errors import UpstreamError
from app.infra.settings import get_settings

log = logging.getLogger("ailegal.tei")


class EmbeddingClient:
    def __init__(self) -> None:
        s = get_settings()
        self._base = s.EMBED_BASE_URL
        self._timeout = s.EMBED_TIMEOUT
        self._batch = s.EMBED_BATCH
        self._dim = s.EMBED_DIM

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Nhúng theo lô. Danh sách rỗng trả rỗng, không gọi mạng."""
        if not texts:
            return []

        out: list[list[float]] = []
        for start in range(0, len(texts), self._batch):
            chunk = [t[:8000] or " " for t in texts[start : start + self._batch]]
            out.extend(self._post("/embed", {"inputs": chunk}))
        return out

    def _post(self, path: str, payload: dict[str, Any]) -> list[list[float]]:
        try:
            with httpx.Client(timeout=self._timeout) as client:
                r = client.post(f"{self._base}{path}", json=payload)
                r.raise_for_status()
                return r.json()
        except httpx.HTTPError as e:
            raise UpstreamError("embedding", f"Không nhúng được: {e}") from e


class RerankClient:
    def __init__(self) -> None:
        s = get_settings()
        self._base = s.RERANK_BASE_URL
        self._timeout = s.RERANK_TIMEOUT
        self._top_n = s.RERANK_TOP_N

    def rerank(
        self, query: str, texts: list[str], *, top_n: int | None = None
    ) -> list[tuple[int, float]]:
        """
        Trả `[(chỉ số trong `texts`, điểm)]` đã sắp giảm dần.

        Rerank hỏng KHÔNG được làm hỏng cả pipeline: trả về thứ tự nguyên bản
        với điểm 0 để tầng trên vẫn chạy bằng dense + BM25.
        """
        if not texts:
            return []
        limit = top_n or self._top_n

        try:
            with httpx.Client(timeout=self._timeout) as client:
                started = time.monotonic()
                r = client.post(
                    f"{self._base}/rerank",
                    json={"query": query[:8000], "texts": [t[:8000] for t in texts]},
                )
                r.raise_for_status()
                body = r.json()
                log.debug("rerank %d đoạn trong %.2fs", len(texts), time.monotonic() - started)
        except (httpx.HTTPError, ValueError) as e:
            log.warning("rerank lỗi, bỏ qua tầng này: %s", e)
            return [(i, 0.0) for i in range(min(limit, len(texts)))]

        pairs = [(int(item["index"]), float(item["score"])) for item in body]
        pairs.sort(key=lambda p: p[1], reverse=True)
        return pairs[:limit]
