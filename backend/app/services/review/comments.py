"""
Comment 2 chiều theo đoạn / field — TH1.

## Ba quyết định đáng giải thích

**1. DB là nguồn sự thật, không phải file.** PT3 cho phép Purchasing thay thế
hoàn toàn tệp `.docx`. Comment sống trong file thì mỗi lần reupload là mất sạch
thảo luận của người duyệt. Ghi `w:comment` vào file (PA-B) để lại cho bước xuất
bản, không phải chỗ lưu.

**2. Anchor mồ côi thì nói ra, không đoán.** File đổi mà `para_id` mất hoặc nội
dung đoạn đổi thì thread chuyển `orphaned` kèm lý do. Gắn nó vào một đoạn "gần
giống" là tệ hơn im lặng: người duyệt sẽ đọc bình luận của mình bên cạnh một câu
mà họ chưa từng nhìn thấy.

**3. Comment KHÔNG đổi trạng thái ticket.** Quy tắc A4b: mọi yêu cầu chỉnh sửa
đều phải kết thúc bằng Từ chối. Nếu comment tự đẩy ticket về Purchasing thì có
hai đường quay lui và không ai biết đường nào đang chạy.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, ReviewStatus, UserRole
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import (
    CommentReply,
    CommentThread,
    ContractReview,
    DocumentField,
    ReviewFile,
    ReviewVersion,
)
from app.services.document.model import sha256_text
from app.services.review import versions
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.comments")

MAX_CONTENT_CHARS = 4000
QUOTE_CHARS = 400

ANCHOR_FIELD = "field"
ANCHOR_PARAGRAPH = "paragraph"

STATUS_OPEN = "open"
STATUS_RESOLVED = "resolved"
STATUS_ORPHANED = "orphaned"


# ─────────────────────────────────────────────────────────────────────────────
# Quyền
# ─────────────────────────────────────────────────────────────────────────────
def _assert_can_read(db: Session, principal: Principal, review: ContractReview) -> None:
    from app.services.review import service

    service.get_review(db, review.id, principal)  # ném 403/404 đúng phạm vi (A5)


def _assert_can_comment(principal: Principal, review: ContractReview) -> None:
    """
    Ai được mở thread: người duyệt (Manager / Legal / IT) và **chủ ticket**.

    Chủ ticket được phép vì thread là hai chiều — Purchasing phải trả lời được
    và cũng phải hỏi lại được về một đoạn cụ thể.
    """
    principal.require(Permission.CONTRACTS)
    reviewers = (UserRole.PURCHASING_MANAGER, UserRole.LEGAL, UserRole.IT)
    if principal.role not in reviewers and principal.user_id != review.owner_id:
        raise ForbiddenError("Chỉ người duyệt hoặc người tạo mới bình luận được")


# ─────────────────────────────────────────────────────────────────────────────
# Tạo thread
# ─────────────────────────────────────────────────────────────────────────────
def create_thread(
    db: Session,
    principal: Principal,
    review: ContractReview,
    *,
    perm_id: str | None = None,
    para_id: str | None = None,
    content: str,
) -> CommentThread:
    _assert_can_comment(principal, review)
    content = (content or "").strip()
    if not content:
        raise ValidationError("Nội dung bình luận đang rỗng")
    if len(content) > MAX_CONTENT_CHARS:
        raise ValidationError(
            f"Bình luận quá dài (tối đa {MAX_CONTENT_CHARS} ký tự)", code="comment_too_long"
        )
    if not perm_id and not para_id:
        raise ValidationError(
            "Phải neo bình luận vào một vùng mở (permId) hoặc một đoạn (paraId)",
            code="anchor_required",
        )
    if ReviewStatus(review.status).is_terminal:
        raise ConflictError(f"Ticket đã ở trạng thái cuối “{review.status}”", code="review_closed")

    anchor = _resolve_anchor(db, review, perm_id=perm_id, para_id=para_id)

    thread = CommentThread(
        review_id=review.id,
        version_no=review.version,
        anchor_kind=anchor["kind"],
        perm_id=anchor.get("permId"),
        para_id=anchor.get("paraId"),
        text_sha256=anchor["sha256"],
        ordinal=anchor["ordinal"],
        quoted_text=anchor["quote"],
        citation=anchor["citation"],
        status=STATUS_OPEN,
        author_id=principal.user_id,
        author_name=principal.username,
        author_role=principal.role.value,
    )
    db.add(thread)
    db.flush()

    db.add(
        CommentReply(
            thread_id=thread.id,
            content=content,
            author_id=principal.user_id,
            author_name=principal.username,
            author_role=principal.role.value,
        )
    )
    db.flush()
    return thread


def _resolve_anchor(
    db: Session, review: ContractReview, *, perm_id: str | None, para_id: str | None
) -> dict[str, Any]:
    """
    Xác minh neo có thật trong tài liệu, và chụp lại ngữ cảnh.

    Neo không tồn tại thì ném ngay: một thread neo vào hư không sẽ hiện ra là
    `orphaned` ngay lúc tạo, và người dùng không hiểu vì sao.
    """
    version = _current_version(db, review)

    if perm_id:
        field = db.execute(
            select(DocumentField).where(
                DocumentField.version_id == version.id, DocumentField.perm_id == perm_id
            )
        ).scalar_one_or_none()
        if field is None:
            raise ValidationError(
                f"Không tìm thấy vùng “{perm_id}” trong bản hiện tại", code="anchor_not_found"
            )
        return {
            "kind": ANCHOR_FIELD,
            "permId": perm_id,
            "paraId": (field.para_ids or [None])[0],
            "sha256": sha256_text(field.value_text),
            "ordinal": field.ordinal,
            "quote": field.value_text[:QUOTE_CHARS],
            "citation": field.label or "",
        }

    paragraph = _paragraph(db, review, version, str(para_id))
    if paragraph is None:
        raise ValidationError(
            f"Không tìm thấy đoạn “{para_id}” trong bản hiện tại", code="anchor_not_found"
        )
    return {
        "kind": ANCHOR_PARAGRAPH,
        "permId": None,
        "paraId": para_id,
        "sha256": paragraph.text_sha256,
        "ordinal": paragraph.ordinal,
        "quote": paragraph.text[:QUOTE_CHARS],
        "citation": paragraph.numbering_label or "",
    }


def _current_version(db: Session, review: ContractReview) -> ReviewVersion:
    """Version MANG TỆP đang có hiệu lực — xem `versions.current_document`."""
    return versions.current_document(db, review)


def _paragraphs(db: Session, review: ContractReview, version: ReviewVersion):
    from app.services.document.ooxml import DocxPackage
    from app.services.document.ooxml_reader import OoxmlReader

    file_row = db.get(ReviewFile, version.file_id) if version.file_id else None
    if file_row is None:
        return []
    blob = get_storage().get(file_row.storage_key)
    return OoxmlReader().read(DocxPackage.load(blob)).paragraphs


def _paragraph(db: Session, review: ContractReview, version: ReviewVersion, para_id: str):
    return next((p for p in _paragraphs(db, review, version) if p.para_id == para_id), None)


# ─────────────────────────────────────────────────────────────────────────────
# Trả lời / đóng thread
# ─────────────────────────────────────────────────────────────────────────────
def reply(
    db: Session,
    principal: Principal,
    review: ContractReview,
    thread_id: uuid.UUID,
    content: str,
) -> CommentThread:
    _assert_can_comment(principal, review)
    content = (content or "").strip()
    if not content:
        raise ValidationError("Nội dung trả lời đang rỗng")

    thread = _thread(db, review, thread_id)
    if thread.status == STATUS_RESOLVED:
        raise ConflictError("Thread đã đóng — mở thread mới nếu còn vấn đề", code="thread_resolved")

    db.add(
        CommentReply(
            thread_id=thread.id,
            content=content[:MAX_CONTENT_CHARS],
            author_id=principal.user_id,
            author_name=principal.username,
            author_role=principal.role.value,
        )
    )
    db.flush()
    return thread


def resolve(
    db: Session, principal: Principal, review: ContractReview, thread_id: uuid.UUID
) -> CommentThread:
    """
    Đóng thread. **Không** đổi trạng thái ticket.

    Quy tắc A4b: yêu cầu chỉnh sửa phải kết thúc bằng Từ chối, không phải bằng
    việc đóng bình luận. Trộn hai thứ là có hai đường quay lui.
    """
    _assert_can_comment(principal, review)
    thread = _thread(db, review, thread_id)
    if thread.status == STATUS_RESOLVED:
        return thread

    from datetime import datetime, timezone

    thread.status = STATUS_RESOLVED
    thread.resolved_at = datetime.now(timezone.utc)
    thread.resolved_by = principal.user_id
    db.flush()
    return thread


def _thread(db: Session, review: ContractReview, thread_id: uuid.UUID) -> CommentThread:
    thread = db.get(CommentThread, thread_id)
    if thread is None or thread.review_id != review.id:
        raise NotFoundError("Bình luận")
    return thread


# ─────────────────────────────────────────────────────────────────────────────
# Đọc + tái neo
# ─────────────────────────────────────────────────────────────────────────────
def list_threads(db: Session, principal: Principal, review: ContractReview) -> list[dict[str, Any]]:
    _assert_can_read(db, principal, review)
    reanchor(db, review)

    threads = list(
        db.execute(
            select(CommentThread)
            .where(CommentThread.review_id == review.id)
            .order_by(CommentThread.ordinal, CommentThread.created_at)
        ).scalars()
    )
    replies: dict[uuid.UUID, list[CommentReply]] = {}
    for r in db.execute(
        select(CommentReply)
        .where(CommentReply.thread_id.in_([t.id for t in threads] or [uuid.uuid4()]))
        .order_by(CommentReply.created_at)
    ).scalars():
        replies.setdefault(r.thread_id, []).append(r)

    return [_thread_out(t, replies.get(t.id, [])) for t in threads]


def _thread_out(thread: CommentThread, replies: list[CommentReply]) -> dict[str, Any]:
    return {
        "id": str(thread.id),
        "anchorKind": thread.anchor_kind,
        "permId": thread.perm_id,
        "paraId": thread.para_id,
        "ordinal": thread.ordinal,
        "citation": thread.citation,
        "quotedText": thread.quoted_text,
        "status": thread.status,
        "orphanReason": thread.orphan_reason,
        "versionNo": thread.version_no,
        "authorName": thread.author_name,
        "authorRole": thread.author_role,
        "createdAt": thread.created_at.isoformat() if thread.created_at else "",
        "resolvedAt": thread.resolved_at.isoformat() if thread.resolved_at else None,
        "replies": [
            {
                "id": str(r.id),
                "content": r.content,
                "authorName": r.author_name,
                "authorRole": r.author_role,
                "createdAt": r.created_at.isoformat() if r.created_at else "",
            }
            for r in replies
        ],
    }


def reanchor(db: Session, review: ContractReview) -> int:
    """
    Đối chiếu lại mọi thread `open` với bản tài liệu hiện tại.

    Trả về số thread vừa bị đánh mồ côi. Chạy lúc ĐỌC chứ không phải lúc ghi
    file: tài liệu đổi được từ nhiều đường (ghi trường, chat, reupload PT3), và
    nhớ gọi ở tất cả các đường là điều sớm muộn sẽ quên.
    """
    threads = list(
        db.execute(
            select(CommentThread).where(
                CommentThread.review_id == review.id,
                CommentThread.status == STATUS_OPEN,
            )
        ).scalars()
    )
    if not threads:
        return 0

    try:
        version = _current_version(db, review)
    except ConflictError:
        return 0

    fields = {
        f.perm_id: f
        for f in db.execute(
            select(DocumentField).where(DocumentField.version_id == version.id)
        ).scalars()
    }
    paragraphs = {p.para_id: p for p in _paragraphs(db, review, version)}

    orphaned = 0
    for thread in threads:
        reason = _orphan_reason(thread, fields, paragraphs)
        if reason:
            thread.status = STATUS_ORPHANED
            thread.orphan_reason = reason
            orphaned += 1

    if orphaned:
        db.flush()
        log.info("%s: %d bình luận mất neo sau khi tài liệu đổi", review.code, orphaned)
    return orphaned


def _orphan_reason(thread: CommentThread, fields: dict, paragraphs: dict) -> str | None:
    """
    `None` = neo còn tốt.

    Vùng mở đổi NỘI DUNG thì thread vẫn sống — bình luận nói về chính vùng đó,
    và vùng đó chính là chỗ người ta đang sửa. Chỉ khi vùng **biến mất** mới là
    mồ côi. Ngược lại, đoạn KHOÁ mà đổi nội dung thì thread mất chỗ dựa: bình
    luận nói về câu chữ nào đó không còn tồn tại.
    """
    if thread.anchor_kind == ANCHOR_FIELD:
        if thread.perm_id not in fields:
            return "Vùng mở được neo không còn trong tài liệu"
        return None

    paragraph = paragraphs.get(thread.para_id or "")
    if paragraph is None:
        return "Đoạn được neo không còn trong tài liệu"
    if thread.text_sha256 and paragraph.text_sha256 != thread.text_sha256:
        return "Nội dung đoạn được neo đã thay đổi"
    return None


__all__ = [
    "create_thread",
    "list_threads",
    "reanchor",
    "reply",
    "resolve",
]
