#!/usr/bin/env python3
"""
Dọn dữ liệu thử nghiệm để test tay trên UI cho sạch.

Mặc định XOÁ: toàn bộ hợp đồng và mọi thứ treo theo nó (version, file metadata,
findings, đề xuất, chat, bình luận, outbox eContract, nhật ký callback).

Mặc định GIỮ: người dùng, danh mục, checklist, phân quyền ký, template đã đăng
ký — tức toàn bộ **cấu hình**.

`--config` xoá thêm **template** và **checklist**. Dùng khi hai thứ đó cũng là
dữ liệu do test sinh ra chứ không phải bản thật của Legal. LUÔN giữ người dùng,
danh mục và bảng phân quyền ký (không có nó thì Legal không duyệt được).

    python3 scripts/demo-reset.py                    # xem sẽ xoá gì, KHÔNG xoá
    python3 scripts/demo-reset.py --yes              # xoá dữ liệu hợp đồng
    python3 scripts/demo-reset.py --yes --config     # xoá thêm template + checklist

Blob trong MinIO KHÔNG bị xoá — chúng thành mồ côi và vô hại. Muốn dọn hẳn thì
xoá bucket qua console MinIO (cổng 9101).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.infra.db import session_scope
from app.infra.models import (
    AiFinding,
    AiProposal,
    AiRun,
    ChatMessage,
    ChecklistConfig,
    CommentReply,
    CommentThread,
    ContractReview,
    ContractTemplate,
    DocumentField,
    EcontractEvent,
    EcontractOutbox,
    FeedbackItem,
    ReviewFile,
    ReviewVersion,
)
from sqlalchemy import func, select, text

# Thứ tự QUAN TRỌNG: con trước, cha sau. Có FK `ondelete=CASCADE` nhưng
# `review_versions` và `comment_replies` có trigger chặn DELETE, nên phải tắt
# trigger tạm thời — xem `_wipe`.
TABLES = [
    ("bình luận (lượt)", CommentReply),
    ("bình luận (thread)", CommentThread),
    ("callback eContract", EcontractEvent),
    ("outbox eContract", EcontractOutbox),
    ("phát hiện AI", AiFinding),
    ("đề xuất AI", AiProposal),
    ("lần chạy AI", AiRun),
    ("tin nhắn chat", ChatMessage),
    ("phản hồi duyệt", FeedbackItem),
    ("vùng tài liệu", DocumentField),
    ("version", ReviewVersion),
    ("tệp", ReviewFile),
    ("hợp đồng", ContractReview),
]

# Chỉ xoá khi có `--config`. Đây là **cấu hình**, không phải dữ liệu vận hành —
# xoá nhầm thì Legal phải đăng ký lại template và soạn lại checklist.
CONFIG_TABLES = [
    ("template hợp đồng", ContractTemplate),
    ("checklist", ChecklistConfig),
]


def _count(db, model) -> int:
    return int(db.execute(select(func.count()).select_from(model)).scalar_one())


def main() -> int:
    confirm = "--yes" in sys.argv
    with_config = "--config" in sys.argv
    tables = TABLES + (CONFIG_TABLES if with_config else [])

    with session_scope() as db:
        counts = [(label, model, _count(db, model)) for label, model in tables]

    total = sum(c for _, _, c in counts)
    print("Sẽ xoá:")
    for label, _, count in counts:
        if count:
            print(f"  {count:>6}  {label}")
    if not total:
        print("  (không có gì)")
        return 0

    if not confirm:
        print(f"\nTổng {total} bản ghi. Chạy lại với --yes để xoá thật.")
        if with_config:
            print("GIỮ: người dùng, danh mục, phân quyền ký.")
        else:
            print("GIỮ: người dùng, danh mục, checklist, phân quyền ký, template.")
            print("Thêm --config để xoá cả template và checklist.")
        return 0

    # Các bảng append-only có trigger chặn DELETE. Tắt trigger cho TẤT CẢ bảng
    # bị đụng tới, không liệt kê tay: thiếu một bảng thì cả transaction abort ở
    # giữa chừng và mọi lệnh sau đó im lặng bị bỏ qua. Đã dính đúng lỗi đó với
    # `econtract_events`.
    targets = [model.__tablename__ for _, model, _ in counts]

    with session_scope() as db:
        for table in targets:
            db.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER USER"))
        try:
            for label, model, _ in counts:
                deleted = db.query(model).delete(synchronize_session=False)
                if deleted:
                    print(f"  đã xoá {deleted:>6}  {label}")
        finally:
            for table in targets:
                db.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER USER"))

    print("\nXong. Blob trong MinIO thành mồ côi (vô hại) — dọn qua console 9101 nếu muốn.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
