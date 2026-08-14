"""Router của tầng API. Mỗi module một nhóm nghiệp vụ."""

from __future__ import annotations

from app.api.routers.auth import router as auth_router
from app.api.routers.catalogs import router as catalogs_router
from app.api.routers.reviews import router as reviews_router
from app.api.routers.users import router as users_router

ALL_ROUTERS = (auth_router, catalogs_router, users_router, reviews_router)

__all__ = ["ALL_ROUTERS"]
