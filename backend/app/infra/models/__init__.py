"""
Model SQLAlchemy — ánh xạ DDL của TS-02.

`alembic/env.py` import package này để `Base.metadata` đầy đủ trước khi
autogenerate. Bảng nào không được import ở đây thì migration sẽ KHÔNG thấy.
"""

from __future__ import annotations

from app.infra.models.ai import AiFinding, AiProposal, AiRun
from app.infra.models.audit import AuditLog
from app.infra.models.catalog import (
    CATALOG_KINDS,
    CatalogItem,
    ContractTemplate,
    DocumentSequence,
)
from app.infra.models.config import ChecklistConfig, SigningAuthorityRule
from app.infra.models.econtract import EcontractEvent, EcontractOutbox
from app.infra.models.review import (
    ChatMessage,
    ContractReview,
    DocumentField,
    FeedbackItem,
    ReviewFile,
    ReviewVersion,
)
from app.infra.models.user import User

__all__ = [
    "CATALOG_KINDS",
    "AiFinding",
    "AiProposal",
    "AiRun",
    "AuditLog",
    "CatalogItem",
    "ChatMessage",
    "ChecklistConfig",
    "ContractReview",
    "ContractTemplate",
    "DocumentField",
    "DocumentSequence",
    "EcontractEvent",
    "EcontractOutbox",
    "FeedbackItem",
    "ReviewFile",
    "ReviewVersion",
    "SigningAuthorityRule",
    "User",
]
