"""AI Legal — điểm vào FastAPI."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.routers import ALL_ROUTERS
from app.infra.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ở dev bucket có thể chưa tồn tại; ở prod `minio-init` đã tạo sẵn.
    # Không được làm app chết nếu MinIO chưa lên — readiness sẽ báo.
    try:
        from app.services.storage.objects import get_storage

        get_storage().ensure_bucket()
    except Exception as e:
        import logging

        logging.getLogger("ailegal").warning("chưa sẵn sàng object storage: %s", e)
    yield


app = FastAPI(
    title="AI Legal API",
    version="0.1.0",
    description=(
        "Hệ thống AI Review Hợp đồng — Saint-Gobain Việt Nam. Phase 1: hợp đồng khung.\n\n"
        "**Ràng buộc C-3:** không endpoint nào cho phép ghi vào vùng khoá của tài liệu."
    ),
    lifespan=lifespan,
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
)


register_error_handlers(app)
for _router in ALL_ROUTERS:
    app.include_router(_router)


@app.get("/health", tags=["ops"])
def health() -> dict[str, Any]:
    """Liveness. Cố ý KHÔNG gọi DB/Redis — dùng cho healthcheck của container."""
    return {"status": "ok", "env": settings.ENV, "version": app.version}


@app.get("/health/ready", tags=["ops"])
def ready() -> dict[str, Any]:
    """
    Readiness — kiểm cả phụ thuộc.
    Ba endpoint model là service NGOÀI: chúng chết thì hệ thống vẫn phải chạy
    được ở chế độ fallback (NFR-R1), nên KHÔNG tính vào điều kiện sẵn sàng.
    """
    checks: dict[str, str] = {}
    ok = True

    try:
        from sqlalchemy import create_engine, text

        with create_engine(settings.DATABASE_URL, pool_pre_ping=True).connect() as c:
            c.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"lỗi: {type(e).__name__}"
        ok = False

    try:
        import redis

        redis.Redis.from_url(settings.REDIS_URL, socket_timeout=2).ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"lỗi: {type(e).__name__}"
        ok = False

    return {"status": "ok" if ok else "degraded", "checks": checks}
