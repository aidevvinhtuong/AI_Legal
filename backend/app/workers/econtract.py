"""
Job đẩy hợp đồng sang FPT.eContract.

Ba task, mỗi task một việc:

  `econtract.push`       gửi đúng một bản ghi outbox (được đánh thức ngay sau
                         khi người tạo bấm Submit)
  `econtract.drain`      quét các bản ghi tới hạn thử lại — lưới an toàn cho ca
                         Redis mất job hoặc worker chết giữa chừng
  `econtract.reconcile`  hỏi lại trạng thái envelope, phòng callback không tới
                         (rủi ro R5)

Không dùng `autoretry_for`: cơ chế thử lại nằm ở outbox (có backoff, có đếm
lần, có lưu lỗi cuối) chứ không ở Celery. Hai tầng retry chồng nhau thì số lần
gọi FPT thành tích của hai con số, và không ai tra được vì sao.
"""

from __future__ import annotations

import logging

from app.infra.db import session_scope
from app.services.econtract import service
from app.workers.celery_app import celery_app

log = logging.getLogger("ailegal.worker.econtract")


@celery_app.task(name="econtract.push", bind=True)
def push_task(self, outbox_id: str) -> dict:
    with session_scope() as db:
        return service.dispatch(db, outbox_id)


@celery_app.task(name="econtract.drain")
def drain_task() -> dict:
    """Gửi mọi bản ghi outbox đã tới hạn. Chạy tuần tự để giữ FIFO (C-7)."""
    results: list[dict] = []
    with session_scope() as db:
        rows = service.due_outbox(db)
        ids = [row.id for row in rows]
    for outbox_id in ids:
        with session_scope() as db:
            results.append(service.dispatch(db, outbox_id))
    return {"processed": len(results)}


@celery_app.task(name="econtract.reconcile")
def reconcile_task() -> dict:
    with session_scope() as db:
        return service.reconcile(db)


def enqueue_push(outbox_id) -> str | None:
    """
    Đánh thức worker. Redis chết thì trả `None` — **không** làm hỏng request:
    bản ghi outbox vẫn nằm đó và `econtract.drain` sẽ vớt sau.
    """
    try:
        return push_task.delay(str(outbox_id)).id
    except Exception as e:
        log.error("không đẩy được job econtract vào hàng đợi: %s", e)
        return None
