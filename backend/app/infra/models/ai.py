"""
Vết chạy AI.

`ai_runs` phải đủ để **tái lập** một kết luận: đây là hệ thống pháp chế, mỗi con
số phải bảo vệ được trước Legal và trước audit. Thiếu `prompt_version` hay
`checklist_config_version` thì sáu tháng sau không ai giải thích nổi vì sao AI
từng nói thế.

Endpoint model là dịch vụ dùng chung, không do ta vận hành, nên mỗi lần chạy còn
gọi `GET /v1/models` và ghi lại phản hồi vào `model_hash` — nếu bên kia đổi model
dưới cùng một tên, ta vẫn phát hiện được (TS-12 mục II.1).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import TimestampMixin, UuidPkMixin


class AiRun(UuidPkMixin, TimestampMixin, Base):
    __tablename__ = "ai_runs"
    __table_args__ = (Index("ix_ai_runs_review_created", "review_id", "created_at"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    stage: Mapped[str] = mapped_column(String(48), nullable=False)

    model_id: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    model_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    prompt_stage: Mapped[str] = mapped_column(String(48), nullable=False, default="")
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    checklist_config_version: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    temperature: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, server_default="0")
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    status: Mapped[str] = mapped_column(String(24), nullable=False, server_default="ok")
    # Kết quả từ tầng rule-based vì LLM hỏng — UI phải hiện banner cảnh báo (B4)
    is_fallback: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Giải thích được từng biến của hai điểm số (yêu cầu bắt buộc — 7.4)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class AiFinding(UuidPkMixin, Base):
    """Một phát hiện, thuộc đúng một trong bốn nhóm hiển thị."""

    __tablename__ = "ai_findings"
    __table_args__ = (Index("ix_ai_findings_review_group", "review_id", "group_name"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("ai_runs.id", ondelete="SET NULL")
    )
    group_name: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    clause_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Có permId ⇒ Loại A (vùng mở); NULL ⇒ Loại B (vùng khoá, chỉ chú thích)
    related_field_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Nguồn: 'rule' (deterministic) hay 'llm' — cần cho việc giải thích kết quả
    source: Mapped[str] = mapped_column(String(16), nullable=False, server_default="rule")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AiProposal(UuidPkMixin, TimestampMixin, Base):
    """Đề xuất sửa. Loại A ghi được; Loại B chỉ chú thích, không có nút Accept."""

    __tablename__ = "ai_proposals"
    __table_args__ = (Index("ix_ai_proposals_review_status", "review_id", "status"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("ai_runs.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(4), nullable=False)  # A | B
    field_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # permId
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    original_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    proposed_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    confidence: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, server_default="0")
