"""
Kết nối PostgreSQL.

Dùng SQLAlchemy **đồng bộ**, không async. Lý do: Celery worker vốn là đồng bộ,
`lxml` là đồng bộ, và tải của hệ thống này rất nhỏ (≥50 HĐ/ngày — NFR-P1).
Async chỉ thêm hai màu hàm và một lớp bug mà không đổi được gì về hiệu năng.
FastAPI tự đẩy route đồng bộ sang threadpool.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.infra.settings import get_settings

log = logging.getLogger("ailegal.db")

# Đặt tên ràng buộc theo quy ước để Alembic autogenerate sinh migration ổn định.
# Thiếu cái này thì ràng buộc do Postgres tự đặt tên, và mỗi lần autogenerate lại
# ra một tên khác nhau — migration sẽ nhiễu và khó review.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


_settings = get_settings()

engine = create_engine(
    _settings.DATABASE_URL,
    pool_pre_ping=True,  # kết nối chết sau khi Postgres restart sẽ tự dựng lại
    pool_size=10,
    max_overflow=20,
    echo=False,
    future=True,
)

SessionFactory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dependency của FastAPI. Rollback khi có lỗi, luôn đóng."""
    session = SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def on_commit(session: Session, callback: Callable[[], None]) -> None:
    """
    Chạy `callback` SAU KHI transaction commit thành công.

    Bắt buộc cho mọi lần đánh thức worker. Gọi `task.delay()` ngay trong
    request là một cuộc đua có thật, không phải rủi ro lý thuyết: worker nhận
    job trong vài mili-giây, truy vấn bản ghi mà transaction chưa commit, không
    thấy gì, rồi kết thúc im lặng. Đo được trên máy dev — job `econtract.push`
    trả `{"status": "missing"}` 5ms sau khi được đẩy.

    Lỗi bên trong `callback` không được làm hỏng request: dữ liệu đã commit
    xong rồi, và job vẫn còn trong outbox cho lượt quét định kỳ vớt lại.
    """

    @event.listens_for(session, "after_commit", once=True)
    def _fire(_session: Session) -> None:  # pragma: no cover — chạy trong event loop của SA
        try:
            callback()
        except Exception as e:
            log.error("hook after_commit lỗi: %s", e)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Dùng trong worker và script — nơi không có dependency injection."""
    session = SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
