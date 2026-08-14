"""
ORM → JSON đúng hình dạng `frontend/src/lib/types.ts`.

Tách riêng khỏi router vì đây là **hợp đồng với FE**: đổi một khoá ở đây là FE
phải sửa. Gom một chỗ thì thấy ngay ảnh hưởng, thay vì rải rác trong 10 endpoint.

DB dùng `snake_case`, API trả `camelCase` (backend/CLAUDE.md mục 5).
"""

from __future__ import annotations

from typing import Any

from app.infra.models import (
    AiFinding,
    AiProposal,
    ChatMessage,
    ContractReview,
    DocumentField,
    FeedbackItem,
    ReviewFile,
    ReviewVersion,
    User,
)

# Tiền tố API. Khai một chỗ để link do BE sinh ra không bao giờ lệch với
# đường dẫn router phục vụ — đúng cái đã gây lỗi `/api/v1/v1/...`.
API_PREFIX = "/api/v1"


def iso(value: Any) -> str:
    return value.isoformat() if value is not None else ""


# ─────────────────────────────────────────────────────────────────────────────
# Người dùng
# ─────────────────────────────────────────────────────────────────────────────
def user_out(user: User) -> dict[str, Any]:
    """KHÔNG bao giờ trả `password`/`password_hash` — FE demo có field đó, BE thì không."""
    return {
        "id": str(user.id),
        "username": user.username,
        "fullName": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "role": user.role,
        "lineManagerId": str(user.line_manager_id) if user.line_manager_id else None,
        "permissions": list(user.permissions or []),
        "active": user.active,
        "createdAt": iso(user.created_at),
        "updatedAt": iso(user.updated_at),
    }


def session_out(user: User, token: str, permissions: list[str]) -> dict[str, Any]:
    return {
        "token": token,
        "userId": str(user.id),
        "username": user.username,
        "name": user.full_name or user.username,
        "email": user.email,
        "role": user.role,
        "department": user.department,
        "permissions": permissions,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tài liệu
# ─────────────────────────────────────────────────────────────────────────────
def field_out(field: DocumentField) -> dict[str, Any]:
    """
    `EditableField` của FE.

    `locked=True` cho vùng rỗng và vùng bắc qua bảng — chúng có tồn tại, người
    dùng nhìn thấy, nhưng hệ thống không ghi được (chế độ C của TS-04).
    """
    return {
        "id": field.perm_id,
        "label": field.label or f"Vùng mở #{field.ordinal}",
        "type": field.field_type,
        "value": field.value_text,
        "locked": not field.writable,
        # Ngoài hợp đồng FE — giúp UI chọn ô nhập hay vùng soạn thảo nhiều dòng
        "regionKind": field.region_kind,
        "paraCount": field.para_count,
        "charLen": field.char_len,
    }


def proposal_out(proposal: AiProposal) -> dict[str, Any]:
    return {
        "id": str(proposal.id),
        "kind": proposal.kind,
        "fieldId": proposal.field_id,
        "title": proposal.title,
        "reason": proposal.reason,
        "originalText": proposal.original_text,
        "proposedText": proposal.proposed_text,
        "status": proposal.status,
        "confidence": float(proposal.confidence),
    }


def message_out(message: ChatMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "createdAt": iso(message.created_at),
    }


def feedback_out(item: FeedbackItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "fieldId": item.field_id,
        "clauseLabel": item.clause_label,
        "comment": item.comment,
        "done": item.done,
        "attachments": item.attachments or [],
    }


def finding_out(finding: AiFinding) -> dict[str, Any]:
    return {
        "id": str(finding.id),
        "title": finding.title,
        "description": finding.description,
        "severity": finding.severity,
        "relatedFieldId": finding.related_field_id,
    }


def version_out(version: ReviewVersion, file: ReviewFile | None) -> dict[str, Any]:
    return {
        "version": version.version,
        "action": version.action,
        "actorRole": version.actor_role,
        "actorName": version.actor_name,
        "label": version.label,
        "createdAt": iso(version.created_at),
        "fileName": file.file_name if file else "",
        "reviewedText": "",
        "feedback": version.feedback or [],
        "fieldDiff": version.field_diff or [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Ticket
# ─────────────────────────────────────────────────────────────────────────────
def insight_out(review: ContractReview, findings: list[AiFinding]) -> dict[str, Any]:
    """
    Bốn nhóm phát hiện + hai điểm số **tách biệt**.

    `aiConfidenceScore` = AI chắc chắn tới đâu về phân tích của chính nó.
    `fairnessScore`     = điều khoản cân bằng tới đâu cho Công ty.
    Hai chỉ số khác nhau về ý nghĩa, không được trộn (yêu cầu mục 7.4).
    """
    buckets: dict[str, list[dict[str, Any]]] = {
        "redFlags": [],
        "warnings": [],
        "protections": [],
        "missingProtections": [],
    }
    mapping = {
        "red_flag": "redFlags",
        "warning": "warnings",
        "protection": "protections",
        "missing_protection": "missingProtections",
    }
    for finding in findings:
        key = mapping.get(finding.group_name)
        if key:
            buckets[key].append(finding_out(finding))

    return {
        "contractId": str(review.id),
        "contractName": review.title,
        "aiConfidenceScore": float(review.confidence),
        "fairnessScore": float(review.fairness),
        "aiSummary": review.ai_summary,
        "lastUpdatedAt": iso(review.updated_at),
        "groups": buckets,
    }


def review_out(
    review: ContractReview,
    *,
    owner: User | None = None,
    fields: list[DocumentField] | None = None,
    proposals: list[AiProposal] | None = None,
    messages: list[ChatMessage] | None = None,
    findings: list[AiFinding] | None = None,
    feedback: list[FeedbackItem] | None = None,
    versions: list[tuple[ReviewVersion, ReviewFile | None]] | None = None,
    files: dict[str, ReviewFile] | None = None,
) -> dict[str, Any]:
    """
    `ContractReview` đầy đủ — FE thay nguyên state bằng object này sau mỗi
    mutation, nên endpoint nào sửa ticket cũng phải trả về bản đầy đủ.
    """
    files = files or {}
    original = files.get("original")
    reviewed = files.get("reviewed")

    return {
        "id": str(review.id),
        "documentId": review.document_id,
        "code": review.code,
        "title": review.title,
        "contractTypeId": review.contract_type_id,
        "contractTypeLabel": review.contract_type_label,
        "group": review.group,
        "status": review.status,
        "kind": review.kind,
        "ownerId": str(review.owner_id),
        "ownerName": (owner.full_name or owner.username) if owner else "",
        "fileName": original.file_name if original else "",
        "fileNames": [f.file_name for f in files.values()],
        # Link tải đi qua endpoint kiểm quyền, KHÔNG phải presigned URL trần:
        # FE nhúng thẳng vào preview nên URL không được rò ra ngoài phiên.
        #
        # Dùng đúng đường dẫn thật của API. FE gọi `/api/v1/...` và proxy chuyển
        # tiếp nguyên vẹn, nên link sinh ở đây dán thẳng vào trình duyệt cũng
        # chạy — không còn hai hệ đường dẫn để lệch nhau.
        #
        # `reviewed` trả link ngay cả khi chưa có bản sửa nào: endpoint tải tự
        # lùi về bản gốc. FE khỏi phải xử lý null ở mọi chỗ nhúng preview.
        "originalDocxUrl": f"{API_PREFIX}/reviews/{review.id}/files/original"
        if original
        else None,
        "reviewedDocxUrl": (
            f"{API_PREFIX}/reviews/{review.id}/files/reviewed"
            if (reviewed or original)
            else None
        ),
        "attachments": [],
        "prompt": review.prompt,
        "version": review.version,
        "versionHistory": [version_out(v, f) for v, f in (versions or [])],
        "confidence": float(review.confidence),
        "createdAt": iso(review.created_at),
        "updatedAt": iso(review.updated_at),
        "queuePosition": review.queue_position,
        "failureReason": review.failure_reason,
        # Phase 1 làm việc theo trường, không theo toàn văn — hai khoá này giữ
        # rỗng để FE cũ không vỡ, và sẽ bỏ hẳn khi FE chuyển sang dùng `fields`.
        "originalText": "",
        "reviewedText": "",
        "fields": [field_out(f) for f in (fields or [])],
        "proposals": [proposal_out(p) for p in (proposals or [])],
        "messages": [message_out(m) for m in (messages or [])],
        "recipients": [],
        "feedback": [feedback_out(f) for f in (feedback or [])],
        "contractInsight": insight_out(review, findings or []),
        "confidenceDetail": {
            "score": float(review.confidence),
            "pros": [],
            "cons": [],
            "clauseSummaries": [],
            "recentFieldChanges": [],
        },
        "disclaimerAcknowledged": review.disclaimer_acknowledged,
        "intake": review.intake or {},
        "econtract": review.econtract,
        "rowVersion": review.row_version,
    }
