"""
Vòng đời ticket review — bảng trung tâm của hệ thống.

Ba điểm thiết kế đáng lưu ý:

  1. `review_versions` là **snapshot bất biến**. Một bộ đếm chung tăng dần,
     không phân biệt actor (v1 submit → v2 reject kèm sửa → v3 resubmit).
     Không bao giờ UPDATE, không bao giờ DELETE.
  2. `document_fields` là **allow-list** của version hiện hành. Tầng ghi đọc
     đúng bảng này để biết permId nào được phép sửa — nguồn sự thật không nằm ở
     request, không nằm ở cấu hình, mà ở kiểm kê đọc từ chính file.
  3. Blob nằm ở MinIO, DB chỉ giữ metadata + hash (phản biện quyết định D3 —
     TS-02 mục VII).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base
from app.infra.models.base import RowVersionMixin, TimestampMixin, UuidPkMixin


class ContractReview(UuidPkMixin, TimestampMixin, RowVersionMixin, Base):
    __tablename__ = "contract_reviews"
    __table_args__ = (
        UniqueConstraint("code", name="uq_contract_reviews_code"),
        Index("ix_contract_reviews_owner_status", "owner_id", "status"),
        Index("ix_contract_reviews_status_created", "status", "created_at"),
    )

    # `code` = Số tài liệu (VTS.HQP.260001) — cũng là refId gửi FPT.eContract
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    document_id: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(500), nullable=False)

    kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default="full")
    status: Mapped[str] = mapped_column(String(32), nullable=False, server_default="draft")

    owner_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    # Khoá checklist AI = slug của Tên hợp đồng (Blueprint §1.3.5)
    contract_type_id: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    contract_type_label: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    group: Mapped[str] = mapped_column(String(16), nullable=False, server_default="framework")

    template_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_templates.id", ondelete="SET NULL")
    )

    intake: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")

    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    confidence: Mapped[float] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="0"
    )
    fairness: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, server_default="0")
    ai_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")

    disclaimer_acknowledged: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    queue_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    econtract: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class ReviewFile(UuidPkMixin, TimestampMixin, Base):
    """
    Metadata blob. Nội dung thật nằm ở MinIO theo `storage_key`.

    `sha256` cho phép phát hiện file bị thay ngoài luồng và là chỗ dựa để đối
    chiếu khi khôi phục từ backup lệch nhau giữa DB và object storage.
    """

    __tablename__ = "review_files"
    __table_args__ = (Index("ix_review_files_review_kind", "review_id", "kind"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # original|reviewed|attachment
    file_name: Mapped[str] = mapped_column(String(300), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class ReviewVersion(UuidPkMixin, Base):
    """Snapshot bất biến. Trigger trong migration chặn UPDATE và DELETE."""

    __tablename__ = "review_versions"
    __table_args__ = (
        UniqueConstraint("review_id", "version", name="uq_review_versions_review_id_version"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False, default="")

    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")

    file_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("review_files.id", ondelete="SET NULL")
    )
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    # Diff cấp field: [{permId, label, old, new}] — Phase 1 không cần diff văn bản tự do
    field_diff: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    feedback: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocumentField(UuidPkMixin, TimestampMixin, Base):
    """
    Kiểm kê vùng mở/khoá của một version — CHÍNH LÀ allow-list Lớp 1 (C-3).

    Đọc lại từ file sau mỗi lần ghi, không suy diễn từ lần trước: file mới thì
    allow-list mới.
    """

    __tablename__ = "document_fields"
    __table_args__ = (
        UniqueConstraint("version_id", "perm_id", name="uq_document_fields_version_id_perm_id"),
        Index("ix_document_fields_review", "review_id"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("review_versions.id", ondelete="CASCADE"), nullable=False
    )

    perm_id: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    region_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    writable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    # Tên nghiệp vụ từ template_field_map; rỗng thì UI hiển thị "Vùng mở #n"
    label: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    field_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="text")
    value_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    char_len: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    para_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    para_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, server_default="[]")
    in_table: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class ChatMessage(UuidPkMixin, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_messages_review_created", "review_id", "created_at"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FeedbackItem(UuidPkMixin, TimestampMixin, Base):
    """Structured feedback khi Manager/Legal từ chối (A4b: sửa luôn đi kèm Reject)."""

    __tablename__ = "feedback_items"
    __table_args__ = (Index("ix_feedback_items_review", "review_id"),)

    review_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("contract_reviews.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    field_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    clause_label: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    author_role: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
