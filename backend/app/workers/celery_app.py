"""
Celery — hàng đợi xử lý AI.

Vì sao bắt buộc phải có, không thể chạy đồng bộ trong request: đo thực tế trên
hợp đồng THACO với checklist 4 điều khoản là **38 giây**. Checklist thật 20–30
điều khoản sẽ là vài phút, mà NFR-P2 cho phép tới 10 phút/HĐ. Không proxy nào
chờ được lâu như vậy — và không nên chờ.

Hai cấu hình BẮT BUỘC, không được đổi vì "tối ưu":

  `worker_prefetch_multiplier = 1`
      Mặc định Celery cho một worker ôm sẵn nhiều job rồi để đó. Job AI chạy
      dài nên điều đó phá vỡ FIFO (ràng buộc C-7): job vào sau có thể chạy
      trước chỉ vì rơi vào worker rảnh.

  `task_acks_late = True`
      Chỉ ack sau khi job xong. Worker chết giữa chừng thì job quay lại hàng
      đợi thay vì biến mất (NFR-R3).
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.infra.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "ailegal",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.ai_review", "app.workers.econtract"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # FIFO — xem docstring
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Job AI dài; cắt cứng ở 10 phút đúng theo NFR-P2 để không có job treo mãi
    task_time_limit=660,
    task_soft_time_limit=600,
    result_expires=86400,
    task_default_queue="ai",
    task_routes={
        "ai.review": {"queue": "ai"},
        "ai.chat": {"queue": "interactive"},
        "ai.drain": {"queue": "io"},
        # Gọi FPT là I/O ngắn — để chung hàng đợi `ai` thì nó phải xếp sau các
        # job AI vài phút, người dùng đứng nhìn "đang đồng bộ" mà không hiểu vì sao.
        "econtract.push": {"queue": "io"},
        "econtract.drain": {"queue": "io"},
        "econtract.reconcile": {"queue": "io"},
    },
    beat_schedule={
        # Đối soát định kỳ phòng callback treo (rủi ro R5). 10 phút là đủ dày để
        # người dùng không thấy ticket đứng im, đủ thưa để không spam FPT.
        "econtract-reconcile": {
            "task": "econtract.reconcile",
            "schedule": crontab(minute="*/10"),
        },
        # Vớt các bản ghi outbox tới hạn thử lại mà không ai đánh thức.
        "econtract-drain": {
            "task": "econtract.drain",
            "schedule": crontab(minute="*/5"),
        },
        # Vớt ticket kẹt ở `queued` vì Redis chết đúng lúc đẩy job.
        "ai-drain": {
            "task": "ai.drain",
            "schedule": crontab(minute="*/5"),
        },
    },
)
