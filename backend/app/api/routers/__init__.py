"""Router của tầng API. Mỗi module một nhóm nghiệp vụ."""

from __future__ import annotations

from app.api.routers.auth import router as auth_router
from app.api.routers.catalogs import router as catalogs_router
from app.api.routers.config import router as config_router
from app.api.routers.econtract import router as econtract_router
from app.api.routers.reviews import router as reviews_router
from app.api.routers.signing_rules import router as signing_rules_router
from app.api.routers.system_prompts import router as system_prompts_router
from app.api.routers.templates import router as templates_router
from app.api.routers.users import router as users_router

ALL_ROUTERS = (
    auth_router,
    catalogs_router,
    users_router,
    reviews_router,
    econtract_router,
    config_router,
    signing_rules_router,
    system_prompts_router,
    templates_router,
)

__all__ = ["ALL_ROUTERS"]
