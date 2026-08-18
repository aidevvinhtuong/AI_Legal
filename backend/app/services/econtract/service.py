"""
Đẩy hợp đồng sang FPT.eContract — outbox, gửi, callback, đối soát, huỷ.

Bốn quy tắc chi phối toàn bộ module:

  1. **Request không gọi mạng.** `queue_push()` chỉ ghi ý định vào outbox trong
     cùng transaction với việc đổi trạng thái. Worker mới là bên gọi FPT.
  2. **Idempotency theo `refId`** (= `review.code`), khoá bằng UNIQUE trên
     `(review_id, kind)`. Bấm Submit mười lần vẫn đúng một envelope.
  3. **Chỉ lỗi hạ tầng mới thử lại.** Lỗi `code: 13` của FPT là lỗi dữ liệu —
     thử lại nghìn lần vẫn sai, chỉ làm chậm và làm nhiễu log.
  4. **Callback không tin được một mình.** FPT có thể không gọi, gọi trùng, hoặc
     gọi từ nguồn giả. Nên có cả chữ ký HMAC lẫn job đối soát định kỳ (rủi ro R5).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ReviewAction, ReviewStatus, VersionAction
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, UpstreamError
from app.domain.rbac import Principal
from app.infra.models import ContractReview, EcontractEvent, EcontractOutbox, ReviewFile
from app.infra.settings import get_settings
from app.services.econtract import markers
from app.services.econtract.client import EnvelopeResult, get_client, is_mock
from app.services.econtract.errors import EcontractError, describe_envelope_status
from app.services.econtract.payload import build_excall_payload, redact
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.econtract")

OUTBOX_CREATE = "create"
OUTBOX_CANCEL = "cancel"

# Trạng thái bên FPT → hành động bên mình.
TERMINAL_OK = frozenset({"Completed"})
TERMINAL_BAD = frozenset({"Rejected", "Voided", "Overdue"})

RETRY_BASE_SECONDS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ─────────────────────────────────────────────────────────────────────────────
# Người tạo bấm Submit
# ─────────────────────────────────────────────────────────────────────────────
def queue_push(
    db: Session, principal: Principal, review: ContractReview
) -> tuple[ContractReview, EcontractOutbox]:
    """
    Chốt luồng ký, sinh bản `.docx` có marker, xếp job đẩy FPT.

    Không gọi FPT ở đây. Nếu có gọi thì một lỗi mạng sẽ rollback cả việc đổi
    trạng thái, và người dùng bấm lại sẽ tạo bản xuất bản thứ hai.
    """
    from app.services.review import service as review_service

    markers.assert_ready_to_push(review)
    file_row = markers.build_signing_rendition(db, principal, review)

    settings = get_settings()
    payload = build_excall_payload(
        review_code=review.code,
        title=review.title,
        file_name=file_row.file_name,
        intake=review.intake or {},
        recipients=review.recipients or [],
        file_base64="",  # base64 gắn vào lúc gửi, không lưu trong DB
        selector=settings.ECONTRACT_SELECTOR,
        doc_type_code=settings.ECONTRACT_DOC_TYPE_CODE,
    )

    row = db.execute(
        select(EcontractOutbox).where(
            EcontractOutbox.review_id == review.id,
            EcontractOutbox.kind == OUTBOX_CREATE,
        )
    ).scalar_one_or_none()

    if row is not None and row.status == "sent":
        raise ConflictError(
            f"Hợp đồng đã được đẩy sang FPT.eContract (envelope {row.envelope_id})",
            code="already_pushed",
        )
    if row is None:
        row = EcontractOutbox(review_id=review.id, kind=OUTBOX_CREATE, ref_id=review.code)
        db.add(row)

    row.file_id = file_row.id
    row.payload = redact({**payload, "body": {**payload["body"], "file": ""}})
    row.status = "pending"
    row.attempts = 0
    row.next_attempt_at = _now()
    row.last_error = None
    row.last_error_code = None

    review_service.apply_action(
        db,
        principal,
        review,
        ReviewAction.PUSH_ECONTRACT,
        context_overrides={"markers_valid": True},
    )

    review.version += 1
    review_service.record_version(
        db,
        review=review,
        action=VersionAction.MARKER_INSERT,
        principal=principal,
        file=file_row,
        label=f"Chèn {len(markers.build_placements(review))} marker ký số",
    )

    review.econtract = {
        "envelopeId": None,
        "envStatus": "Queued",
        "code": 0,
        "message": "Đã xếp hàng đẩy sang FPT.eContract",
        "pushedAt": _now().isoformat(),
        "fileMode": "docx",
        "isMock": is_mock(),
    }
    db.flush()
    return review, row


# ─────────────────────────────────────────────────────────────────────────────
# Worker gửi
# ─────────────────────────────────────────────────────────────────────────────
def dispatch(db: Session, outbox_id: Any) -> dict[str, Any]:
    """
    Gửi một bản ghi outbox. An toàn khi gọi lại: đã `sent` thì trả ngay.
    """
    row = db.get(EcontractOutbox, outbox_id)
    if row is None:
        return {"status": "missing"}
    if row.status == "sent":
        return {"status": "sent", "envelopeId": row.envelope_id}

    review = db.get(ContractReview, row.review_id)
    if review is None:
        row.status = "dead"
        row.last_error = "ticket không còn tồn tại"
        return {"status": "dead"}

    row.attempts += 1
    try:
        result = _send(db, row)
    except EcontractError as e:
        return _handle_failure(db, row, review, e)

    row.status = "sent"
    row.sent_at = _now()
    row.envelope_id = result.envelope_id
    row.last_error = None
    row.last_error_code = None

    review.econtract = {
        "envelopeId": result.envelope_id,
        "envStatus": result.env_status or "Processing",
        "code": result.code,
        "message": result.message or describe_envelope_status(result.env_status),
        "webView": result.web_view,
        "pushedAt": _now().isoformat(),
        "fileMode": "docx",
        "isMock": is_mock(),
    }
    _audit(db, review, "econtract_pushed", {"envelopeId": result.envelope_id})
    db.flush()
    log.info("đã đẩy %s sang eContract, envelope=%s", review.code, result.envelope_id)
    return {"status": "sent", "envelopeId": result.envelope_id}


def _send(db: Session, row: EcontractOutbox) -> EnvelopeResult:
    file_row = db.get(ReviewFile, row.file_id) if row.file_id else None
    if file_row is None:
        raise EcontractError(
            "Không tìm thấy bản .docx đã chèn marker để gửi",
            code="missingRendition",
            retryable=False,
        )
    blob = get_storage().get(file_row.storage_key)

    payload = {
        **row.payload,
        "body": {
            **row.payload.get("body", {}),
            # D1c đã chốt: FPT nhận `.docx` dạng base64, không convert PDF.
            "file": base64.b64encode(blob).decode("ascii"),
        },
    }
    return get_client().create_envelope(payload)


def _handle_failure(
    db: Session, row: EcontractOutbox, review: ContractReview, error: EcontractError
) -> dict[str, Any]:
    from app.services.review import service as review_service

    row.last_error = error.message[:2000]
    row.last_error_code = (error.code or "")[:64]

    max_attempts = get_settings().ECONTRACT_MAX_ATTEMPTS
    can_retry = error.retryable and row.attempts < max_attempts

    if can_retry:
        row.status = "pending"
        row.next_attempt_at = _now() + timedelta(seconds=RETRY_BASE_SECONDS * 2**row.attempts)
        log.warning(
            "đẩy %s lỗi (lần %d/%d): %s — thử lại lúc %s",
            review.code,
            row.attempts,
            max_attempts,
            error.message,
            row.next_attempt_at,
        )
        db.flush()
        return {"status": "retry", "attempts": row.attempts}

    row.status = "dead" if error.retryable else "failed"
    review.econtract = {
        **(review.econtract or {}),
        "envStatus": "Failed",
        "code": 13 if error.code in _FPT_VALIDATION_CODES else 1,
        "error": error.message,
        "errorCode": error.code,
        "failedAt": _now().isoformat(),
    }
    if review.status == ReviewStatus.SYNCING_ECONTRACT.value:
        review_service.apply_action(db, None, review, ReviewAction.ECONTRACT_FAIL)
    _audit(db, review, "econtract_failed", {"error": error.message, "code": error.code})
    db.flush()
    log.error("đẩy %s thất bại vĩnh viễn: %s", review.code, error.message)
    return {"status": row.status, "error": error.message}


_FPT_VALIDATION_CODES = frozenset(
    {
        "isNotExistsMarkerField",
        "tooManyMarkerDigitalField",
        "wrongFieldWithRole",
        "isNotExistsRecipientInfo",
        "recipientRoleIsNull",
        "isNotExistsIndividual",
        "docTypeCodeIsNotExists",
        "requestNotContainsRefId",
    }
)


def due_outbox(db: Session, limit: int = 20) -> list[EcontractOutbox]:
    return list(
        db.execute(
            select(EcontractOutbox)
            .where(
                EcontractOutbox.status == "pending",
                EcontractOutbox.next_attempt_at <= _now(),
            )
            .order_by(EcontractOutbox.next_attempt_at)  # FIFO, ràng buộc C-7
            .limit(limit)
        ).scalars()
    )


# ─────────────────────────────────────────────────────────────────────────────
# Callback
# ─────────────────────────────────────────────────────────────────────────────
def verify_signature(raw_body: bytes, signature: str | None) -> bool:
    """
    HMAC-SHA256 của thân request với khoá dùng chung.

    Chưa chốt với FPT là họ ký kiểu gì (câu hỏi D1d). Cấu hình chưa có khoá thì:
    môi trường dev chấp nhận để phát triển được, môi trường prod **từ chối** —
    không có đường tắt cho phép ai cũng đổi được trạng thái hợp đồng.
    """
    secret = get_settings().ECONTRACT_CALLBACK_SECRET
    if not secret:
        return not get_settings().is_prod
    if not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().removeprefix("sha256="))


def handle_callback(
    db: Session, *, event_type: str, body: dict[str, Any], signature_ok: bool
) -> dict[str, Any]:
    """
    Nhận `Recipient_push_info` / `Recipient_finished` / `Flow_finished`.

    Callback sai chữ ký VẪN được ghi nhật ký (để điều tra) nhưng KHÔNG được đổi
    trạng thái ticket.
    """
    envelope_id = str(_pick(body, "envelopeId", "envelopeID") or "")
    ref_id = str(_pick(body, "refId", "lookup") or "")
    env_status = str(_pick(body, "envStatus", "status") or "")

    review = _find_review(db, envelope_id=envelope_id, ref_id=ref_id)

    # Áp trạng thái TRƯỚC, ghi nhật ký SAU. `econtract_events` là bảng
    # append-only (trigger chặn UPDATE), nên `applied` phải đúng ngay lúc INSERT
    # — không có lần sửa thứ hai.
    reason = ""
    applied = False
    if not signature_ok:
        reason = "invalid_signature"
        log.warning("callback %s bị từ chối: chữ ký không hợp lệ", event_type)
    elif review is None:
        # Không phải lỗi: callback có thể tới trước khi ta kịp lưu envelopeId.
        # Bản ghi event vẫn còn để job đối soát dùng lại sau.
        reason = "review_not_found"
        log.warning("callback %s không khớp ticket nào (envelope=%s)", event_type, envelope_id)
    else:
        applied = _apply_status(db, review, env_status, source=f"callback:{event_type}")

    db.add(
        EcontractEvent(
            review_id=review.id if review else None,
            envelope_id=envelope_id,
            ref_id=ref_id,
            event_type=event_type,
            env_status=env_status,
            payload=_redact_event(body),
            signature_ok=signature_ok,
            applied=applied,
        )
    )
    db.flush()

    if not signature_ok:
        return {"accepted": False, "reason": reason}
    return {
        "accepted": True,
        "applied": applied,
        "reason": reason,
        "status": review.status if review else None,
    }


def _redact_event(body: dict[str, Any]) -> dict[str, Any]:
    """
    Bỏ file đính kèm khỏi nhật ký.

    `Flow_finished` mang theo file đã ký; nhận file đó nằm NGOÀI phạm vi Sprint 1
    (ràng buộc C-5, hệ thống hiện hữu lo). Giữ nguyên base64 trong JSONB chỉ làm
    phình DB mà không ai dùng.
    """
    import copy

    safe = copy.deepcopy(body)
    for key in ("file", "fileContent", "documentBase64"):
        if key in safe:
            safe[key] = f"<đã lược bỏ, {len(str(body[key]))} ký tự>"
    return safe


def _find_review(db: Session, *, envelope_id: str, ref_id: str) -> ContractReview | None:
    if ref_id:
        found = db.execute(
            select(ContractReview).where(ContractReview.code == ref_id)
        ).scalar_one_or_none()
        if found is not None:
            return found
    if envelope_id:
        row = (
            db.execute(select(EcontractOutbox).where(EcontractOutbox.envelope_id == envelope_id))
            .scalars()
            .first()
        )
        if row is not None:
            return db.get(ContractReview, row.review_id)
    return None


def _apply_status(db: Session, review: ContractReview, env_status: str, *, source: str) -> bool:
    from app.services.review import service as review_service

    if review.status != ReviewStatus.SYNCING_ECONTRACT.value:
        return False  # đã chốt rồi — callback trùng, bỏ qua

    review.econtract = {
        **(review.econtract or {}),
        "envStatus": env_status,
        "message": describe_envelope_status(env_status),
        "updatedAt": _now().isoformat(),
        "source": source,
    }

    if env_status in TERMINAL_OK:
        review_service.apply_action(db, None, review, ReviewAction.ECONTRACT_DONE)
    elif env_status in TERMINAL_BAD:
        review_service.apply_action(db, None, review, ReviewAction.ECONTRACT_FAIL)
    else:
        return False

    _audit(db, review, "econtract_status", {"envStatus": env_status, "source": source})
    return True


def _pick(body: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if body.get(key):
            return body[key]
    data = body.get("data") or body.get("body") or {}
    if isinstance(data, dict):
        for key in keys:
            if data.get(key):
                return data[key]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Đối soát định kỳ (phòng callback treo — rủi ro R5)
# ─────────────────────────────────────────────────────────────────────────────
def reconcile(db: Session, *, older_than_minutes: int = 10, limit: int = 50) -> dict[str, int]:
    cutoff = _now() - timedelta(minutes=older_than_minutes)
    rows = list(
        db.execute(
            select(EcontractOutbox)
            .where(
                EcontractOutbox.status == "sent",
                EcontractOutbox.sent_at <= cutoff,
            )
            .limit(limit)
        ).scalars()
    )

    checked = updated = 0
    client = get_client()
    for row in rows:
        review = db.get(ContractReview, row.review_id)
        if review is None or review.status != ReviewStatus.SYNCING_ECONTRACT.value:
            continue
        contact_id = _first_contact_id(review)
        if not contact_id or not row.envelope_id:
            continue
        checked += 1
        try:
            body = client.recipient_status(contact_id=contact_id, envelope_id=row.envelope_id)
        except EcontractError as e:
            log.warning("đối soát %s lỗi: %s", review.code, e.message)
            continue
        status = str(_pick(body, "envStatus", "status") or "")
        if _apply_status(db, review, status, source="reconcile"):
            updated += 1
    db.flush()
    return {"checked": checked, "updated": updated}


def _first_contact_id(review: ContractReview) -> str:
    from app.services.econtract.payload import resolve_contact_id
    from app.services.econtract.validation import signing_recipients

    flow = signing_recipients(review.recipients or [])
    return resolve_contact_id(flow[0]) if flow else ""


# ─────────────────────────────────────────────────────────────────────────────
# Huỷ
# ─────────────────────────────────────────────────────────────────────────────
def cancel_envelope(
    db: Session, principal: Principal, review: ContractReview, reason: str
) -> dict[str, Any]:
    """
    Huỷ hợp đồng đang trình ký (API 3.1.4).

    Gọi đồng bộ chứ không qua outbox: đây là thao tác tương tác, người dùng cần
    biết ngay kết quả, và huỷ nhầm rồi thử lại nền là hành vi tệ.
    """
    from app.domain.enums import UserRole

    if principal.role not in (UserRole.LEGAL, UserRole.IT) and principal.user_id != review.owner_id:
        raise ForbiddenError("Chỉ người tạo, Legal hoặc IT mới huỷ được hợp đồng đã trình ký")

    row = db.execute(
        select(EcontractOutbox).where(
            EcontractOutbox.review_id == review.id, EcontractOutbox.kind == OUTBOX_CREATE
        )
    ).scalar_one_or_none()
    envelope_id = (row.envelope_id if row else None) or (review.econtract or {}).get("envelopeId")
    if not envelope_id:
        raise NotFoundError("Envelope trên FPT.eContract")
    if not (reason or "").strip():
        from app.domain.errors import ValidationError

        raise ValidationError("Phải nhập lý do huỷ — FPT yêu cầu và người ký sẽ nhìn thấy")

    try:
        body = get_client().cancel(envelope_id=envelope_id, reason=reason)
    except EcontractError as e:
        raise UpstreamError("FPT.eContract", e.message) from e

    review.econtract = {
        **(review.econtract or {}),
        "envStatus": "Voided",
        "message": describe_envelope_status("Voided"),
        "cancelReason": reason,
        "cancelledAt": _now().isoformat(),
    }
    if review.status == ReviewStatus.SYNCING_ECONTRACT.value:
        from app.services.review import service as review_service

        review_service.apply_action(db, None, review, ReviewAction.ECONTRACT_FAIL)
    _audit(db, review, "econtract_cancelled", {"envelopeId": envelope_id, "reason": reason})
    db.flush()
    return {"envelopeId": envelope_id, "result": body}


# ─────────────────────────────────────────────────────────────────────────────
def _audit(db: Session, review: ContractReview, action: str, payload: dict[str, Any]) -> None:
    from app.infra.models import AuditLog

    db.add(
        AuditLog(
            actor_name="system",
            actor_role="system",
            action=action,
            entity_type="contract_review",
            entity_id=str(review.id),
            new_value=payload,
        )
    )


__all__ = [
    "OUTBOX_CANCEL",
    "OUTBOX_CREATE",
    "cancel_envelope",
    "dispatch",
    "due_outbox",
    "handle_callback",
    "queue_push",
    "reconcile",
    "verify_signature",
]
