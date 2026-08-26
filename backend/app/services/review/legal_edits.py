"""
Track changes của người duyệt — TH2.

## Bài toán thật sự khó ở đâu

Không phải ở chỗ đọc mark từ SuperDoc. Khó ở chỗ **quy một thao tác sửa trong
trình duyệt về đúng một vùng mở** — vì F10 cho thấy 10 đoạn của template thật là
đoạn **hỗn hợp**: vùng mở nằm GIỮA câu bị khoá.

    Điều 3.1  "Bên Bán giao hàng cho Bên Mua trong vòng [30] ngày kể từ ngày
               [ký hợp đồng]."
               └── khoá ──┘         └mở┘ └─ khoá ─┘  └───mở───┘  └ khoá ┘

Nên "người duyệt sửa đoạn này" KHÔNG được dịch thành "ghi lại cả đoạn" — làm thế
là viết đè lên câu do Legal khoá. Phải xác định mẩu chữ bị đổi rơi vào **khoảng
nào** trong đoạn, rồi đối chiếu khoảng đó với span của vùng mở.

## Thuật toán quy chiếu

FE gửi `before` / `after` là **toàn văn đoạn** trước và sau khi áp đề xuất. Ở đây
cắt tiền tố và hậu tố chung để lấy đúng mẩu đã đổi:

    before = "…trong vòng 30 ngày kể từ…"
    after  = "…trong vòng 45 ngày kể từ…"
              └── prefix ──┘  ↑  └ suffix ┘
                          old="30" new="45"  tại offset = len(prefix)

Rồi kiểm tra `[offset, offset+len(old))` có nằm trọn trong span của một vùng mở
không. Không nằm trọn ⇒ đề xuất chạm vùng khoá ⇒ `target = "locked"`, ghi nhận
nhưng không áp được.

Cách này xử lý được cả ba ca bằng một công thức: thay thế (old≠"" new≠""), chèn
thêm (old="") và xoá (new="").

## Vì sao sai ở đây vẫn không phá được vùng khoá

Việc áp đề xuất đi qua `service.save_fields()` → `apply_field_changes()`, nơi có
allow-list Lớp 1 và hậu kiểm Lớp 2 `diff_outside()`. Nghĩa là kể cả logic quy
chiếu trong file này có bug, hậu quả xấu nhất là **một đề xuất bị áp sai chỗ
trong vùng mở** — không bao giờ là một ký tự vùng khoá bị đổi. Đó là lý do hai
lớp chặn kia không được phép bỏ, dù tầng nào phía trên đã kiểm rồi.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import Permission, ReviewStatus, UserRole
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from app.domain.rbac import Principal
from app.infra.models import (
    ContractReview,
    DocumentField,
    LegalEdit,
    ReviewFile,
    ReviewVersion,
)
from app.infra.models.legal_edit import (
    KIND_DELETE,
    KIND_FORMAT,
    KIND_INSERT,
    KIND_REPLACE,
    STATUS_APPLIED,
    STATUS_ORPHANED,
    STATUS_PENDING,
    STATUS_REJECTED,
    TARGET_LOCKED,
    TARGET_OPEN,
)
from app.services.document.allowlist import FieldChange
from app.services.document.model import ParagraphDescriptor, sha256_text
from app.services.review import versions
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.legal_edits")

MAX_TEXT_CHARS = 20_000
MAX_EDITS_PER_SUBMIT = 100

KINDS = {KIND_INSERT, KIND_DELETE, KIND_REPLACE, KIND_FORMAT}

# Lý do không áp được — chuỗi cố định để đếm được bằng metric và dịch được ở FE
BLOCKED_NO_REGION = "Đoạn này không nằm trong vùng mở nào — thuộc phần Legal khoá"
BLOCKED_SPANS_LOCKED = "Phần chữ được sửa nằm ngoài vùng mở của đoạn"
BLOCKED_AMBIGUOUS = "Đoạn có nhiều vùng mở, không xác định được sửa vào vùng nào"
BLOCKED_REGION_GONE = "Vùng mở tương ứng không còn trong bản hiện tại"


@dataclass(frozen=True)
class EditIn:
    """
    Một đề xuất đọc ra từ SuperDoc, gom theo **đoạn** chứ không theo mark.

    Một đoạn có thể mang nhiều mark (sửa hai chỗ trong cùng một câu). Nếu tách
    thành hai đề xuất thì áp cái thứ nhất xong, `before` của cái thứ hai không
    còn khớp và nó mồ côi ngay — người duyệt không hiểu vì sao đề xuất của mình
    tự hỏng. Gom theo đoạn cũng đúng cách người ta nghĩ: "tôi sửa điều khoản
    này", không phải "tôi tạo ba mark".
    """

    para_id: str
    kind: str
    before: str
    after: str


# ─────────────────────────────────────────────────────────────────────────────
# Quyền
# ─────────────────────────────────────────────────────────────────────────────
REVIEWER_ROLES = (UserRole.PURCHASING_MANAGER, UserRole.LEGAL, UserRole.IT)


def _assert_can_suggest(principal: Principal, review: ContractReview) -> None:
    """
    Chỉ NGƯỜI DUYỆT đề xuất track changes — đúng phạm vi TH2 của Blueprint.

    Chủ ticket không đi đường này: họ sửa trực tiếp (PT2) hoặc qua chat (PT1).
    Cho cả hai phía dùng chung một lớp diff thì mất ý nghĩa "đề xuất của người
    có thẩm quyền cần được xem xét".
    """
    principal.require(Permission.CONTRACTS)
    if principal.role not in REVIEWER_ROLES:
        raise ForbiddenError("Chỉ Manager hoặc Legal mới đề xuất chỉnh sửa được")
    if ReviewStatus(review.status).is_terminal:
        raise ConflictError(f"Ticket đã ở trạng thái cuối “{review.status}”", code="review_closed")


# ─────────────────────────────────────────────────────────────────────────────
# Nhận đề xuất
# ─────────────────────────────────────────────────────────────────────────────
def submit(
    db: Session, principal: Principal, review: ContractReview, edits: list[EditIn]
) -> list[LegalEdit]:
    _assert_can_suggest(principal, review)
    if not edits:
        raise ValidationError("Không có đề xuất nào để gửi")
    if len(edits) > MAX_EDITS_PER_SUBMIT:
        raise ValidationError(
            f"Quá nhiều đề xuất trong một lần gửi (tối đa {MAX_EDITS_PER_SUBMIT})",
            code="too_many_edits",
        )

    version = _current_version(db, review)
    paragraphs = {p.para_id: p for p in _paragraphs(db, version)}
    fields = list(
        db.execute(
            select(DocumentField).where(DocumentField.version_id == version.id)
        ).scalars()
    )
    segments = region_segments(db, version)
    # Chỉ tra đề xuất ĐANG TREO. Đề xuất đã áp / đã bỏ là lịch sử — vòng review
    # sau người duyệt góp ý lại chính đoạn đó là chuyện bình thường, và phải ra
    # một bản ghi MỚI chứ không phải bị nuốt vì trùng khoá.
    pending = {
        e.change_id: e
        for e in db.execute(
            select(LegalEdit).where(
                LegalEdit.review_id == review.id, LegalEdit.status == STATUS_PENDING
            )
        ).scalars()
    }

    saved: list[LegalEdit] = []
    for item in edits:
        _validate(item)
        paragraph = paragraphs.get(item.para_id)
        if paragraph is None:
            raise ValidationError(
                f"Không tìm thấy đoạn “{item.para_id}” trong bản hiện tại",
                code="anchor_not_found",
            )
        if sha256_text(item.before) != paragraph.text_sha256:
            # Hai nguyên nhân rất khác nhau, đừng gộp làm một:
            #
            #   (a) tài liệu đã đổi thật  → người dùng tải lại là xong
            #   (b) text của trình soạn thảo lệch text backend đọc từ OOXML,
            #       thường là khoảng trắng/tab  → LỖI KỸ THUẬT, người dùng có
            #       tải lại bao nhiêu lần cũng vẫn hỏng
            #
            # Đổ hết cho (a) là biến một bug im lặng thành một bug mà người dùng
            # tưởng do mình. Phải gọi đúng tên để còn sửa được.
            if _normalize(item.before) == _normalize(paragraph.text):
                raise ConflictError(
                    "Nội dung đoạn từ trình soạn thảo không khớp chính xác nội dung "
                    "trong tệp (khác nhau ở khoảng trắng). Đây là lỗi kỹ thuật, "
                    "không phải do tài liệu thay đổi.",
                    code="paragraph_text_mismatch",
                )
            raise ConflictError(
                "Tài liệu đã thay đổi kể từ lúc bạn mở — tải lại rồi đề xuất lại",
                code="document_changed",
            )

        resolution = resolve_target(paragraph, item, fields, segments)

        # Người duyệt sửa lại góp ý của chính mình trên cùng đoạn ⇒ ghi đè bản
        # còn treo thay vì đẻ ra bản thứ hai.
        key = _change_key(item.para_id, principal)
        current = pending.get(key)
        if current is not None:
            current.kind = item.kind
            current.original_text = item.before[:MAX_TEXT_CHARS]
            current.proposed_text = item.after[:MAX_TEXT_CHARS]
            current.text_sha256 = paragraph.text_sha256
            current.perm_id = resolution["permId"]
            current.target = resolution["target"]
            current.blocked_reason = resolution["reason"]
            current.version_no = review.version
            saved.append(current)
            continue

        row = LegalEdit(
            review_id=review.id,
            version_no=review.version,
            change_id=key,
            para_id=item.para_id,
            perm_id=resolution["permId"],
            target=resolution["target"],
            kind=item.kind,
            original_text=item.before[:MAX_TEXT_CHARS],
            proposed_text=item.after[:MAX_TEXT_CHARS],
            text_sha256=paragraph.text_sha256,
            ordinal=paragraph.ordinal,
            citation=paragraph.numbering_label or "",
            status=STATUS_PENDING,
            blocked_reason=resolution["reason"],
            author_id=principal.user_id,
            author_name=principal.username,
            author_role=principal.role.value,
        )
        db.add(row)
        saved.append(row)

    db.flush()
    blocked = sum(1 for e in saved if e.target == TARGET_LOCKED)
    log.info(
        "%s: nhận %d đề xuất TH2 (%d chạm vùng khoá)", review.code, len(saved), blocked
    )
    return saved


def _change_key(para_id: str, principal: Principal) -> str:
    """
    Khoá định danh một đề xuất: **đoạn × người đề xuất**, do SERVER sinh.

    Không nhận từ trình duyệt, vì khoá này là thứ quyết định "sửa đề xuất cũ"
    hay "tạo đề xuất mới" — để client tự đặt là mở đường ghi đè đề xuất của
    người khác. Có `user_id` trong khoá nên Manager và Legal cùng góp ý một
    đoạn vẫn là hai đề xuất độc lập.
    """
    return f"{para_id}:{principal.user_id}"



def _normalize(text: str) -> str:
    """Gộp mọi chuỗi khoảng trắng thành một dấu cách — chỉ dùng để CHẨN ĐOÁN."""
    return " ".join(text.split())

def _validate(item: EditIn) -> None:
    if not item.para_id:
        raise ValidationError("Thiếu `paraId` của đoạn được sửa")
    if item.kind not in KINDS:
        raise ValidationError(f"Loại thay đổi không hợp lệ: “{item.kind}”")
    if item.before == item.after:
        raise ValidationError("Đề xuất không thay đổi gì", code="empty_edit")
    if len(item.after) > MAX_TEXT_CHARS:
        raise ValidationError("Nội dung đề xuất quá dài", code="edit_too_long")


# ─────────────────────────────────────────────────────────────────────────────
# Quy chiếu đề xuất về vùng mở — trái tim của C-3 ở tầng này
# ─────────────────────────────────────────────────────────────────────────────
def changed_span(before: str, after: str) -> tuple[int, str, str]:
    """
    Cắt tiền tố + hậu tố chung, trả `(offset, old, new)`.

    Một hàm cho cả ba ca: sửa (`old` và `new` đều khác rỗng), chèn (`old == ""`)
    và xoá (`new == ""`). Cắt hậu tố phải dừng trước tiền tố, nếu không hai đầu
    ăn lẫn vào nhau khi chuỗi lặp — ví dụ "aaa" → "aaaa".
    """
    start = 0
    limit = min(len(before), len(after))
    while start < limit and before[start] == after[start]:
        start += 1

    end_b, end_a = len(before), len(after)
    while end_b > start and end_a > start and before[end_b - 1] == after[end_a - 1]:
        end_b -= 1
        end_a -= 1

    return start, before[start:end_b], after[start:end_a]


def resolve_target(
    paragraph: ParagraphDescriptor,
    item: EditIn,
    fields: list[DocumentField],
    segments: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """
    Đề xuất này chạm vào vùng mở nào — hay chạm vào vùng khoá?

    `segments` là `{perm_id: {para_id: text_phần_nằm_trong_vùng}}`. **Phải là
    text của SEGMENT, không phải của cả đoạn**: một vùng có thể bắt đầu hoặc kết
    thúc giữa đoạn, nên phần của đoạn nằm trong vùng mới là thứ được phép ghi.
    Đo trên template HDDV thật: 1/120 đoạn thuộc vùng nhiều đoạn rơi vào ca này,
    và nó nằm trong vùng Điều 4 Thanh toán — vùng quan trọng nhất.

    Trả `{"target", "permId", "reason"}`. `target == "locked"` là kết luận hợp
    lệ, không phải lỗi: yêu cầu vẫn được lưu để escalate (khoảng trống F6).
    """
    candidates = [f for f in fields if item.para_id in (f.para_ids or []) and f.writable]
    if not candidates:
        return {"target": TARGET_LOCKED, "permId": None, "reason": BLOCKED_NO_REGION}

    offset, removed, _added = changed_span(item.before, item.after)

    hits = []
    for field in candidates:
        span = _segment_span(paragraph.text, segments.get(field.perm_id, {}).get(item.para_id))
        if span is None:
            continue
        start, stop = span
        # Mẩu bị đổi phải nằm TRỌN trong vùng mở. Chèn thêm (removed == "") thì
        # chỉ cần điểm chèn nằm trong khoảng.
        if start <= offset and offset + len(removed) <= stop:
            hits.append(field)

    if not hits:
        return {"target": TARGET_LOCKED, "permId": None, "reason": BLOCKED_SPANS_LOCKED}
    if len(hits) > 1:
        return {"target": TARGET_LOCKED, "permId": None, "reason": BLOCKED_AMBIGUOUS}
    return {"target": TARGET_OPEN, "permId": hits[0].perm_id, "reason": None}


def _segment_span(paragraph_text: str, segment_text: str | None) -> tuple[int, int] | None:
    """
    Phần thuộc vùng mở nằm ở khoảng nào trong đoạn. `None` = không định vị được.

    Ba ca trả `None`, đều là "không áp được" chứ không phải lỗi:

      * segment rỗng — vùng rỗng bị đánh `writable = False` từ lớp kiểm kê
        (chế độ C của TS-04) nên hầu như không tới được đây
      * không tìm thấy trong đoạn — dữ liệu đã lệch, không đoán
      * **xuất hiện nhiều hơn một lần** — đoạn "Giao 30 ngày, bảo hành 30 ngày"
        có hai chỗ khớp "30"; chọn bừa một chỗ là ghi vào nơi người dùng không
        định sửa, mà cả hai đều hợp lệ nên không có cách nào phát hiện về sau
    """
    if not segment_text:
        return None
    if paragraph_text.count(segment_text) != 1:
        return None
    start = paragraph_text.find(segment_text)
    return start, start + len(segment_text)


def region_segments(db: Session, version: ReviewVersion) -> dict[str, dict[str, str]]:
    """
    `{perm_id: {para_id: text phần nằm trong vùng}}` cho mọi vùng GHI ĐƯỢC.

    Đọc thẳng từ tệp qua `region_locator.locate()` — cùng bộ định vị mà writer
    dùng. Suy ra từ `document_fields.value_text` thì sai ở đúng ca khó: vùng bắt
    đầu/kết thúc giữa đoạn.
    """
    from app.services.document.ooxml import DOCUMENT_PART, DocxPackage
    from app.services.document.region_locator import locate
    from app.services.document.writer_common import find_body

    file_row = db.get(ReviewFile, version.file_id) if version.file_id else None
    if file_row is None:
        return {}

    pkg = DocxPackage.load(get_storage().get(file_row.storage_key))
    body = find_body(pkg.tree(DOCUMENT_PART))

    out: dict[str, dict[str, str]] = {}
    fields = db.execute(
        select(DocumentField).where(
            DocumentField.version_id == version.id, DocumentField.writable.is_(True)
        )
    ).scalars()
    for field in fields:
        try:
            found = locate(body, field.perm_id)
        except Exception as e:  # vùng biến mất khỏi tệp — bỏ qua, không làm hỏng cả lượt
            log.warning("không định vị được vùng %s: %s", field.perm_id, e)
            continue

        para_ids = list(field.para_ids or [])
        if len(para_ids) != len(found):
            # `zip` mặc định sẽ CẮT IM LẶNG phần thừa, tức ánh xạ đoạn → segment
            # lệch đi một và đề xuất bị ghi vào đoạn khác. Hai nguồn này lẽ ra
            # luôn khớp (cùng một tệp, cùng một lượt duyệt); lệch nghĩa là kiểm
            # kê đã cũ so với tệp. Bỏ qua vùng đó để nó rơi về "không áp được",
            # thay vì áp vào nhầm chỗ.
            log.warning(
                "vùng %s: kiểm kê có %d đoạn nhưng tệp định vị được %d — bỏ qua",
                field.perm_id,
                len(para_ids),
                len(found),
            )
            continue

        out[field.perm_id] = {pid: seg.text for pid, seg in zip(para_ids, found, strict=True)}
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Áp / bỏ đề xuất
# ─────────────────────────────────────────────────────────────────────────────
def decide(
    db: Session,
    principal: Principal,
    review: ContractReview,
    edit_id: uuid.UUID,
    action: str,
    note: str = "",
) -> LegalEdit:
    """
    `apply` ghi vào tài liệu, `reject` chỉ đóng đề xuất.

    Quyền ghi KHÔNG kiểm ở đây: `save_fields()` đã ép `assert_can_edit_document`
    — chỉ chủ ticket, và chỉ khi ticket đang ở trạng thái sửa được. Kiểm hai nơi
    thì sớm muộn hai nơi lệch nhau.
    """
    edit = _edit(db, review, edit_id)
    if action not in ("apply", "reject"):
        raise ValidationError(f"Hành động không hợp lệ: “{action}”")
    if edit.status != STATUS_PENDING:
        raise ConflictError(
            f"Đề xuất đã ở trạng thái “{edit.status}”", code="edit_not_pending"
        )

    if action == "reject":
        # `apply` tự có lớp chặn của `save_fields()`, nhưng `reject` chỉ đổi một
        # cột nên KHÔNG có lớp nào phía dưới. Thiếu kiểm ở đây thì bất kỳ ai đọc
        # được ticket cũng xoá sổ được góp ý của người duyệt — im lặng, và người
        # duyệt không bao giờ biết đề xuất của mình đã đi đâu.
        _assert_can_dismiss(principal, review, edit)
        return _close(db, principal, edit, STATUS_REJECTED, note)

    if edit.target != TARGET_OPEN or not edit.perm_id:
        raise ConflictError(
            edit.blocked_reason or BLOCKED_NO_REGION,
            code="edit_targets_locked_region",
        )

    change = _build_change(db, review, edit)

    from app.services.review import service

    service.save_fields(db, principal, review, [change])
    return _close(db, principal, edit, STATUS_APPLIED, note)


def _assert_can_dismiss(principal: Principal, review: ContractReview, edit: LegalEdit) -> None:
    """
    Bỏ một đề xuất: chỉ **chủ ticket** (người phải xử lý nó) hoặc **chính tác
    giả** (rút lại góp ý của mình).

    Người duyệt khác không được xoá góp ý của đồng nghiệp — Manager và Legal có
    thể nhìn nhận một điều khoản khác nhau, và đó là thông tin cần giữ chứ không
    phải xung đột cần dọn.
    """
    principal.require(Permission.CONTRACTS)
    if principal.user_id not in (review.owner_id, edit.author_id):
        raise ForbiddenError("Chỉ người tạo ticket hoặc tác giả đề xuất mới bỏ được đề xuất này")


def _build_change(db: Session, review: ContractReview, edit: LegalEdit) -> FieldChange:
    """
    Dựng giá trị MỚI của cả vùng mở từ một đề xuất cấp đoạn.

    Kiểm lại lần nữa ở thời điểm áp — giữa lúc đề xuất và lúc áp, tài liệu có
    thể đã đổi vì Purchasing sửa trường khác hoặc chat AI vừa ghi.
    """
    version = _current_version(db, review)
    paragraphs = {p.para_id: p for p in _paragraphs(db, version)}
    paragraph = paragraphs.get(edit.para_id)
    if paragraph is None:
        _orphan(db, edit, "Đoạn được đề xuất không còn trong tài liệu")
        raise ConflictError("Đoạn được đề xuất không còn trong tài liệu", code="edit_orphaned")
    if paragraph.text_sha256 != edit.text_sha256:
        _orphan(db, edit, "Nội dung đoạn đã thay đổi sau khi đề xuất được gửi")
        raise ConflictError(
            "Nội dung đoạn đã thay đổi sau khi đề xuất được gửi", code="edit_orphaned"
        )

    field = db.execute(
        select(DocumentField).where(
            DocumentField.version_id == version.id, DocumentField.perm_id == edit.perm_id
        )
    ).scalar_one_or_none()
    if field is None or not field.writable:
        _orphan(db, edit, BLOCKED_REGION_GONE)
        raise ConflictError(BLOCKED_REGION_GONE, code="edit_orphaned")

    # Làm việc trong không gian SEGMENT, không phải không gian đoạn: writer ghi
    # đúng các run nằm trong vùng, nên giá trị phải là phần của đoạn thuộc vùng.
    # Đưa nguyên văn đoạn vào đây là nhét cả câu bị khoá vào trong vùng mở —
    # không vi phạm C-3 (vẫn ghi trong vùng) nhưng nội dung sai hoàn toàn.
    para_ids = list(field.para_ids or [])
    seg_map = region_segments(db, version).get(field.perm_id, {})
    segment_text = seg_map.get(edit.para_id)

    offset, removed, added = changed_span(edit.original_text, edit.proposed_text)
    span = _segment_span(paragraph.text, segment_text)
    if span is None:
        _orphan(db, edit, BLOCKED_SPANS_LOCKED)
        raise ConflictError(BLOCKED_SPANS_LOCKED, code="edit_orphaned")

    start, stop = span
    if not (start <= offset and offset + len(removed) <= stop):
        _orphan(db, edit, BLOCKED_SPANS_LOCKED)
        raise ConflictError(BLOCKED_SPANS_LOCKED, code="edit_targets_locked_region")

    # `_segment_span` chỉ trả khác None khi segment khác rỗng, nên `or ""` ở đây
    # thuần tuý để type checker yên tâm — không dùng `assert`, vì `python -O` bỏ
    # assert và biến một bất biến thành lời hứa suông.
    segment = segment_text or ""
    inner = offset - start
    new_segment = segment[:inner] + added + segment[inner + len(removed) :]

    if len(para_ids) > 1:
        # Vùng nhiều đoạn: writer đòi ĐÚNG số phần tử bằng số đoạn của vùng.
        # Giữ nguyên mọi segment khác, chỉ thay đúng một cái.
        values = [new_segment if pid == edit.para_id else seg_map.get(pid, "") for pid in para_ids]
        return FieldChange(perm_id=field.perm_id, value=values)

    return FieldChange(perm_id=field.perm_id, value=new_segment)


def _close(
    db: Session, principal: Principal, edit: LegalEdit, status: str, note: str
) -> LegalEdit:
    edit.status = status
    edit.decided_at = datetime.now(timezone.utc)
    edit.decided_by = principal.user_id
    edit.decide_note = (note or "").strip()[:300] or None
    db.flush()
    return edit


def _orphan(db: Session, edit: LegalEdit, reason: str) -> None:
    edit.status = STATUS_ORPHANED
    edit.blocked_reason = reason[:300]
    db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Đọc
# ─────────────────────────────────────────────────────────────────────────────
def list_edits(db: Session, principal: Principal, review: ContractReview) -> list[dict[str, Any]]:
    from app.services.review import service

    service.get_review(db, review.id, principal)  # ném 403/404 đúng phạm vi (A5)

    rows = list(
        db.execute(
            select(LegalEdit)
            .where(LegalEdit.review_id == review.id)
            .order_by(LegalEdit.ordinal, LegalEdit.created_at)
        ).scalars()
    )
    return [_out(r) for r in rows]


def _out(edit: LegalEdit) -> dict[str, Any]:
    offset, old, new = changed_span(edit.original_text, edit.proposed_text)
    return {
        "id": str(edit.id),
        "changeId": edit.change_id,
        "paraId": edit.para_id,
        "permId": edit.perm_id,
        "target": edit.target,
        "kind": edit.kind,
        "citation": edit.citation,
        "ordinal": edit.ordinal,
        # Toàn văn đoạn — để hiện ngữ cảnh
        "originalText": edit.original_text,
        "proposedText": edit.proposed_text,
        # Chỉ mẩu đã đổi — để hiện diff gọn, khỏi bắt người đọc tự dò
        "removedText": old,
        "addedText": new,
        "offset": offset,
        "status": edit.status,
        "blockedReason": edit.blocked_reason,
        "versionNo": edit.version_no,
        "authorName": edit.author_name,
        "authorRole": edit.author_role,
        "createdAt": edit.created_at.isoformat() if edit.created_at else "",
        "decidedAt": edit.decided_at.isoformat() if edit.decided_at else None,
        "decideNote": edit.decide_note,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Tiện ích dùng chung
# ─────────────────────────────────────────────────────────────────────────────
def _edit(db: Session, review: ContractReview, edit_id: uuid.UUID) -> LegalEdit:
    edit = db.get(LegalEdit, edit_id)
    if edit is None or edit.review_id != review.id:
        raise NotFoundError("Đề xuất chỉnh sửa")
    return edit


def _current_version(db: Session, review: ContractReview) -> ReviewVersion:
    """Version MANG TỆP đang có hiệu lực — xem `versions.current_document`."""
    return versions.current_document(db, review)


def _paragraphs(db: Session, version: ReviewVersion) -> list[ParagraphDescriptor]:
    from app.services.document.ooxml import DocxPackage
    from app.services.document.ooxml_reader import OoxmlReader

    file_row = db.get(ReviewFile, version.file_id) if version.file_id else None
    if file_row is None:
        return []
    blob = get_storage().get(file_row.storage_key)
    return list(OoxmlReader().read(DocxPackage.load(blob)).paragraphs)


__all__ = [
    "EditIn",
    "changed_span",
    "decide",
    "list_edits",
    "resolve_target",
    "submit",
]
