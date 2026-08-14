"""
Cấu hình tập trung. Mọi biến môi trường đọc ở ĐÂY, không rải `os.environ`
khắp code — để một chỗ duy nhất biết hệ thống cần gì và fail sớm khi thiếu.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Môi trường ────────────────────────────────────────────────────────
    ENV: Literal["dev", "uat", "prod"] = "dev"
    DEBUG: bool = False
    SECRET_KEY: str = Field(min_length=16)
    API_PORT: int = 8010  # 8000/8001 đã bị "PBI Analysis API" chiếm trên máy dev

    # ── PostgreSQL ────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+psycopg://ailegal:ailegal@localhost:55432/ailegal"

    # ── Redis ─────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:63790/0"

    # ── MinIO / S3 ────────────────────────────────────────────────────────
    S3_ENDPOINT: str = "http://localhost:9100"
    S3_ACCESS_KEY: str = "ailegal"
    S3_SECRET_KEY: str = "ailegal-secret"
    S3_BUCKET: str = "ailegal-documents"
    S3_REGION: str = "us-east-1"
    S3_PRESIGN_TTL: int = 120  # giây — đủ để trình duyệt tải, không đủ để chia sẻ

    # ── LLM (OpenAI-compatible) ───────────────────────────────────────────
    # ĐÃ KIỂM CHỨNG 06/08/2026 bằng scripts/check-llm.py.
    LLM_BASE_URL: str = "http://171.244.136.217:8386/v1"
    LLM_MODEL: str = "Qwen/Qwen3.6-27B"
    LLM_API_KEY: str = "EMPTY"  # server không kiểm giá trị, nhưng BẮT BUỘC gửi header
    LLM_TIMEOUT: int = 120
    LLM_MAX_INFLIGHT: int = 32  # trần đồng thời phía client, chặn trước khi vLLM phình hàng đợi
    LLM_MAX_RETRIES: int = 2
    # Qwen3 mặc định bật "thinking" → sinh khối <think> rất dài và chậm.
    # Phải tắt ở MỌI lần gọi. Xem backend/CLAUDE.md mục 4.
    LLM_ENABLE_THINKING: bool = False
    LLM_SEED: int = 42

    # ── Embedding (TEI native: POST /embed) ───────────────────────────────
    EMBED_BASE_URL: str = "http://171.244.136.217:8387"
    EMBED_MODEL: str = "AITeamVN/Vietnamese_Embedding"
    EMBED_DIM: int = 1024
    EMBED_MAX_INPUT: int = 8192
    EMBED_TIMEOUT: int = 60
    EMBED_BATCH: int = 32

    # ── Rerank (TEI native: POST /rerank) ─────────────────────────────────
    RERANK_BASE_URL: str = "http://171.244.136.217:8389"
    RERANK_TIMEOUT: int = 60
    RERANK_TOP_N: int = 5

    # ── Tham số pipeline AI ───────────────────────────────────────────────
    # Model embedding hiện tại CHỈ có dense (không sparse như BGE-M3), nên
    # tầng từ vựng dùng BM25 tính tại chỗ. Xem TS-12 mục II.3.
    MATCH_DENSE_WEIGHT: float = 0.65
    MATCH_BM25_WEIGHT: float = 0.35
    MATCH_THRESHOLD: float = 0.45
    SELF_CONSISTENCY_RUNS: int = 3  # chỉ áp cho clause severity=block

    # ── Ngưỡng tài liệu ───────────────────────────────────────────────────
    ATOMIC_MAX_CHARS: int = 200
    # Van an toàn: mặc định KHÔNG ghi vào vùng bắc qua ranh giới bảng.
    # Chỉ bật sau khi PoC-1 chứng minh không vỡ bảng (TS-04 mục IV.1).
    ALLOW_CROSS_TABLE_WRITE: bool = False
    MAX_UPLOAD_BYTES: int = 20 * 1024 * 1024
    MAX_UNZIP_BYTES: int = 100 * 1024 * 1024  # chống zip bomb
    MAX_ZIP_ENTRIES: int = 500

    # ── Prompt (quản lý bằng Git) ─────────────────────────────────────────
    PROMPTS_DIR: str = "../prompts"

    # ── Xác thực ──────────────────────────────────────────────────────────
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_HOURS: int = 8

    @field_validator("LLM_BASE_URL", "EMBED_BASE_URL", "RERANK_BASE_URL")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @field_validator("MATCH_BM25_WEIGHT")
    @classmethod
    def _weights_sum_to_one(cls, v: float, info) -> float:
        dense = info.data.get("MATCH_DENSE_WEIGHT", 0.0)
        if abs((dense + v) - 1.0) > 1e-6:
            raise ValueError(
                f"MATCH_DENSE_WEIGHT + MATCH_BM25_WEIGHT phải bằng 1.0, đang là {dense + v}"
            )
        return v

    @property
    def is_prod(self) -> bool:
        return self.ENV == "prod"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
