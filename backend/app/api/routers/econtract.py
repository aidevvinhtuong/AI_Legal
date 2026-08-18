"""
Wizard trình ký: người ký · marker · đẩy FPT.eContract.

## Hợp đồng mới với FE (điểm FE phải sửa)

1. **Đặt marker** — vẫn `POST /reviews/{id}/markers/place`, nhưng body đổi từ
   `{page, xPct, yPct}` sang `{recipientId, anchor: {paraId, align, position}}`.
   Toạ độ trang không ánh xạ được sang OOXML.
2. **Danh sách vị trí** — mới: `GET /reviews/{id}/marker-anchors`, FE dùng làm
   điểm hít khi kéo-thả.
3. **Gỡ marker** — mới: `DELETE /reviews/{id}/markers/{recipientId}`, thay cho
   mẹo gọi `updateRecipient` với `marker: undefined`.
4. **Đẩy eContract** — `POST /econtract/push` với `{reviewId, review, username,
   password}` đổi thành `POST /reviews/{id}/econtract/push` **không body**.

Điểm cuối cùng là một lỗ hổng thật, không phải chuyện thẩm mỹ: bản FE demo lấy
username/password đăng nhập FPT từ phiên người dùng rồi gửi lên server ở mỗi
lần Submit. Credentials tích hợp thuộc về server, đọc từ `.env`, và không bao
giờ được đi qua trình duyệt.

`anchor.paraId` là **bắt buộc trên FE mới**. Trong lúc FE chưa đổi, thiếu nó
thì BE suy ra từ `yPct` và trả `marker.approximated = true` — có chạy, nhưng vị
trí chỉ là xấp xỉ. Xem `services/econtract/markers.py`.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.api.presenters import review_out
from app.infra.db import on_commit
from app.infra.models import EcontractOutbox
from app.services.econtract import markers as marker_service
from app.services.econtract import service as econtract_service
from app.services.econtract.client import is_mock
from app.services.econtract.validation import validate_markers
from app.services.review import service
from app.workers.econtract import enqueue_push

router = APIRouter(prefix="/api/v1", tags=["econtract"])


def _out(db, review) -> dict[str, Any]:
    bundle = service.load_bundle(db, review)
    return review_out(
        bundle.review,
        owner=bundle.owner,
        fields=bundle.fields,
        proposals=bundle.proposals,
        messages=bundle.messages,
        findings=bundle.findings,
        feedback=bundle.feedback,
        versions=bundle.versions,
        files=bundle.files,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Bước 1 — người ký
# ─────────────────────────────────────────────────────────────────────────────
class RecipientsIn(BaseModel):
    recipients: list[dict[str, Any]] = Field(default_factory=list)


@router.put("/reviews/{review_id}/recipients")
def save_recipients(
    review_id: uuid.UUID, payload: RecipientsIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """Lưu luồng ký. Server chuẩn hoá lại id và thứ tự — thứ tự này là thứ tự ký."""
    review = service.get_review(db, review_id, principal)
    marker_service.save_recipients(db, principal, review, payload.recipients)
    return _out(db, review)


@router.patch("/reviews/{review_id}/recipients/{recipient_id}")
def patch_recipient(
    review_id: uuid.UUID,
    recipient_id: str,
    patch: dict[str, Any],
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    marker_service.update_recipient(db, principal, review, recipient_id, patch)
    return _out(db, review)


@router.post("/reviews/{review_id}/apply-signing-matrix")
def apply_signing_matrix(
    review_id: uuid.UUID, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    """
    Áp lại bảng Phân quyền ký cho bên mua, GIỮ NGUYÊN bên đối tác.

    Cần thiết khi IT sửa ma trận sau lúc Legal duyệt: không có nút này thì
    người tạo phải nhờ Legal duyệt lại từ đầu.
    """
    review = service.get_review(db, review_id, principal)
    flow = service.preview_signing_flow(db, review)
    if not flow["ready"]:
        from app.domain.errors import ConflictError

        raise ConflictError(flow["reason"] or "Ma trận ký chưa sẵn sàng", code="matrix_not_ready")

    others = [r for r in (review.recipients or []) if not r.get("isMyOrg")]
    marker_service.save_recipients(db, principal, review, [*flow["recipients"], *others])
    return {**_out(db, review), "bandLabel": flow["bandLabel"]}


# ─────────────────────────────────────────────────────────────────────────────
# Bước 2 — marker
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/reviews/{review_id}/marker-anchors")
def marker_anchors(
    review_id: uuid.UUID,
    principal: CurrentUser,
    db: DbSession,
    recommended_only: bool = False,
) -> dict[str, Any]:
    """
    Các vị trí neo marker trong tài liệu hiện hành.

    `recommended` đánh dấu khối chữ ký, tìm bằng dấu hiệu **cấu trúc** (đoạn chỉ
    chứa dòng kẻ `______`) chứ không dò từ khoá tiếng Việt — nội dung nghiệp vụ
    thuộc Legal, không hardcode (bất biến B3).
    """
    review = service.get_review(db, review_id, principal)
    anchors = marker_service.document_anchors(db, review)
    if recommended_only:
        anchors = [a for a in anchors if a.recommended]
    return {
        "reviewId": str(review.id),
        "version": review.version,
        "anchors": marker_service.anchors_out(anchors),
    }


class AnchorIn(BaseModel):
    """
    Neo marker. **`paraId` là trường quan trọng nhất.**

    `page` / `xPct` / `yPct` chỉ là gợi ý hiển thị, BE lưu lại để FE vẽ ô ký lên
    preview; chúng KHÔNG quyết định vị trí ghi vào tài liệu.
    """

    paraId: str = ""  # noqa: N815 — camelCase khớp FE
    align: Literal["left", "center", "right"] = "center"
    position: Literal["after", "before"] = "after"
    page: int | None = None
    xPct: float | None = None  # noqa: N815
    yPct: float | None = None  # noqa: N815


class PlaceMarkerIn(BaseModel):
    recipientId: str = Field(min_length=1)  # noqa: N815
    anchor: AnchorIn = Field(default_factory=AnchorIn)
    signType: str | None = None  # noqa: N815
    height: int | None = None
    width: int | None = None
    sizePreset: Literal["default", "large"] | None = None  # noqa: N815

    # ── Tương thích ngược với FE hiện tại ──────────────────────────────────
    # FE đang gửi page/xPct/yPct phẳng ở gốc body. Nhận luôn để không phải đổi
    # FE và BE cùng lúc; FE mới nên gửi qua `anchor`.
    page: int | None = None
    xPct: float | None = None  # noqa: N815
    yPct: float | None = None  # noqa: N815
    paraId: str | None = None  # noqa: N815

    def to_anchor(self) -> marker_service.AnchorRequest:
        return marker_service.AnchorRequest(
            para_id=self.anchor.paraId or self.paraId or "",
            align=self.anchor.align,
            position=self.anchor.position,
            page=self.anchor.page if self.anchor.page is not None else self.page,
            x_pct=self.anchor.xPct if self.anchor.xPct is not None else self.xPct,
            y_pct=self.anchor.yPct if self.anchor.yPct is not None else self.yPct,
        )


@router.post("/reviews/{review_id}/markers/place")
def place_marker(
    review_id: uuid.UUID,
    payload: PlaceMarkerIn,
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    marker_service.place_marker(
        db,
        principal,
        review,
        recipient_id=payload.recipientId,
        anchor=payload.to_anchor(),
        sign_type=payload.signType,
        height=payload.height,
        width=payload.width,
        size_preset=payload.sizePreset,
    )
    return _out(db, review)


@router.delete("/reviews/{review_id}/markers/{recipient_id}")
def delete_marker(
    review_id: uuid.UUID, recipient_id: str, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    marker_service.clear_marker(db, principal, review, recipient_id)
    return _out(db, review)


@router.get("/reviews/{review_id}/markers/validate")
def validate(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """Xem trước lỗi trước khi Submit — cùng bộ luật server sẽ dùng để chặn."""
    review = service.get_review(db, review_id, principal)
    issues = validate_markers(review.recipients or [])
    return {"ok": not issues, "issues": [i.as_dict() for i in issues]}


# ─────────────────────────────────────────────────────────────────────────────
# Bước 3 — đẩy FPT
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/reviews/{review_id}/econtract/push")
def push(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    """
    Chốt marker và xếp job đẩy sang FPT.

    **Không nhận credentials từ client.** Request chỉ ghi outbox rồi trả ngay;
    worker mới gọi FPT. Redis chết thì job vẫn nằm trong outbox, `econtract.drain`
    vớt sau — không mất hợp đồng.
    """
    review = service.get_review(db, review_id, principal)
    review, row = econtract_service.queue_push(db, principal, review)

    # Đánh thức worker SAU KHI commit. Gọi thẳng ở đây là đua với transaction:
    # worker nhận job trong vài mili-giây và không thấy bản ghi outbox.
    outbox_id = row.id
    on_commit(db, lambda: enqueue_push(outbox_id))

    return {
        **_out(db, review),
        "econtractQueued": True,
        "isMock": is_mock(),
    }


@router.get("/reviews/{review_id}/econtract")
def status(review_id: uuid.UUID, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    outbox = (
        db.execute(select(EcontractOutbox).where(EcontractOutbox.review_id == review.id))
        .scalars()
        .first()
    )
    return {
        "reviewId": str(review.id),
        "status": review.status,
        "econtract": review.econtract or {},
        "isMock": is_mock(),
        "outbox": None
        if outbox is None
        else {
            "status": outbox.status,
            "attempts": outbox.attempts,
            "envelopeId": outbox.envelope_id,
            "lastError": outbox.last_error,
            "lastErrorCode": outbox.last_error_code,
            "nextAttemptAt": outbox.next_attempt_at.isoformat() if outbox.next_attempt_at else None,
        },
    }


class CancelIn(BaseModel):
    reason: str = Field(min_length=1)


@router.post("/reviews/{review_id}/econtract/cancel")
def cancel(
    review_id: uuid.UUID, payload: CancelIn, principal: CurrentUser, db: DbSession
) -> dict[str, Any]:
    review = service.get_review(db, review_id, principal)
    result = econtract_service.cancel_envelope(db, principal, review, payload.reason)
    return {**_out(db, review), "cancel": result}


# ─────────────────────────────────────────────────────────────────────────────
# Callback từ FPT
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/econtract/callback/{event_type}")
async def callback(
    event_type: str,
    request: Request,
    db: DbSession,
    response: Response,
    x_signature: str | None = Header(default=None, alias="X-Signature"),
) -> dict[str, Any]:
    """
    Nhận `Recipient_push_info` / `Recipient_finished` / `Flow_finished`.

    **Không có xác thực người dùng** — FPT gọi tới, không có token của ta. Thay
    vào đó xác thực bằng HMAC thân request. Chữ ký sai vẫn ghi nhật ký (để điều
    tra) nhưng không đổi trạng thái, và trả 401 để FPT biết mà thử lại.

    Cách FPT ký chưa được xác nhận (câu hỏi mở D1d) — khi có thông tin thì chỉ
    sửa `verify_signature()`.
    """
    raw = await request.body()
    ok = econtract_service.verify_signature(raw, x_signature)

    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        body = {"raw": raw.decode("utf-8", "replace")[:2000]}
    if not isinstance(body, dict):
        body = {"raw": body}

    result = econtract_service.handle_callback(
        db, event_type=event_type, body=body, signature_ok=ok
    )
    if not ok:
        response.status_code = 401
    return result


__all__ = ["router"]
