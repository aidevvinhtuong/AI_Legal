"""
Job chạy AI review.

Vòng đời trạng thái do worker điều khiển, đúng máy trạng thái:

    queued → processing → reviewed
                       ↘ failed (kèm lý do, cho phép thử lại)

Idempotency: job nhận `review_id` + `version`. Nếu ticket đã đi qua version đó
rồi thì bỏ qua — chạy lại cùng một job không được nhân đôi findings.
"""

from __future__ import annotations

import logging

from app.domain.enums import ReviewStatus
from app.infra.db import session_scope
from app.infra.models import ContractReview
from app.services.review.ai_review import run_ai_review
from app.workers.celery_app import celery_app

log = logging.getLogger("ailegal.worker.ai")


# Gắn thẳng vào `celery_app` chứ KHÔNG dùng `@shared_task`: shared_task bám vào
# "current app" lúc gọi, nên tiến trình API (không import celery_app) sẽ đẩy job
# vào một Celery app mặc định trỏ localhost — và im lặng thất bại.
@celery_app.task(
    name="ai.review",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    autoretry_for=(),  # tự quyết định retry — xem dưới
)
def review_task(self, review_id: str, expected_version: int | None = None) -> dict:
    """
    Chạy pipeline cho một ticket.

    KHÔNG dùng `autoretry_for`: lỗi đọc tài liệu hay lỗi cấu hình thì thử lại
    bao nhiêu lần cũng vậy. Chỉ đáng thử lại khi dịch vụ ngoài trục trặc, và
    pipeline đã tự xử lý bằng đường fallback rồi.
    """
    with session_scope() as db:
        review = db.get(ContractReview, review_id)
        if review is None:
            log.warning("job cho ticket không tồn tại: %s", review_id)
            return {"status": "missing"}

        if expected_version is not None and review.version != expected_version:
            # Đã có version mới hơn — job này lỗi thời, bỏ qua
            log.info(
                "bỏ qua job cũ cho %s (job v%s, hiện tại v%s)",
                review.code,
                expected_version,
                review.version,
            )
            return {"status": "stale"}

        if review.status not in (ReviewStatus.QUEUED.value, ReviewStatus.PROCESSING.value):
            log.info("bỏ qua %s: trạng thái %s không cần chạy AI", review.code, review.status)
            return {"status": "skipped", "reviewStatus": review.status}

        review.status = ReviewStatus.PROCESSING.value
        db.flush()

    # Chạy ngoài transaction đầu để trạng thái `processing` hiện lên UI ngay,
    # không đợi tới lúc pipeline xong.
    with session_scope() as db:
        review = db.get(ContractReview, review_id)
        try:
            run_ai_review(db, review)
        except Exception as e:
            log.exception("AI review hỏng cho %s", review.code)
            review.status = ReviewStatus.FAILED.value
            review.failure_reason = str(e)[:500]
            db.flush()
            return {"status": "failed", "error": str(e)[:200]}

        return {
            "status": review.status,
            "confidence": float(review.confidence),
            "fairness": float(review.fairness),
        }


@celery_app.task(name="ai.drain")
def drain_task(stale_minutes: int = 2, limit: int = 20) -> dict:
    """
    Vớt ticket kẹt ở `queued` — lưới an toàn cho ca Redis chết đúng lúc đẩy job.

    Không có nó thì một lần Redis trục trặc là ticket nằm ở `queued` vĩnh viễn
    và người dùng chỉ thấy "đang chờ" mà không ai chạy. Ngưỡng 2 phút đủ xa để
    không giẫm lên job vừa đẩy còn đang chờ worker rảnh.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    with session_scope() as db:
        stale = list(
            db.execute(
                select(ContractReview)
                .where(
                    ContractReview.status == ReviewStatus.QUEUED.value,
                    ContractReview.updated_at <= cutoff,
                )
                .order_by(ContractReview.created_at)  # FIFO — ràng buộc C-7
                .limit(limit)
            ).scalars()
        )
        pending = [(str(r.id), r.version, r.code) for r in stale]

    for review_id, version, code in pending:
        log.warning("ticket %s kẹt ở queued — đẩy lại job", code)
        enqueue_review(review_id, version)
    return {"requeued": len(pending)}


def enqueue_review(review_id: str, version: int | None = None) -> str | None:
    """
    Đẩy job vào hàng đợi.

    **Phải gọi sau khi transaction commit** (dùng `infra.db.on_commit`): worker
    nhận job trong vài mili-giây và sẽ không thấy ticket nếu chưa commit.

    Redis chết thì trả `None` chứ không ném — ticket vẫn ở `queued` và
    `ai.drain` sẽ vớt. Làm hỏng cả request chỉ vì hàng đợi trục trặc là đánh đổi
    tệ hơn nhiều.
    """
    try:
        return review_task.delay(review_id, version).id
    except Exception as e:
        log.error("không đẩy được job vào hàng đợi: %s", e)
        return None
