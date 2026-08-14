"""
Đổi `AppError` sang RFC 9457 (`application/problem+json`).

`frontend/src/lib/api.ts` đọc lần lượt `error` → `message` → `detail`, nên giữ
`detail` là chuỗi thì FE hiện thông báo đúng mà không phải sửa gì.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.errors import AppError
from app.services.document.errors import (
    DocumentWriteError,
    LockViolationError,
    PostcheckFailedError,
)

log = logging.getLogger("ailegal.api")

PROBLEM_JSON = "application/problem+json"


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        if exc.status >= 500:
            log.exception("lỗi hệ thống: %s", exc.code)
        return JSONResponse(
            status_code=exc.status,
            content=exc.to_problem(instance=str(request.url.path)),
            media_type=PROBLEM_JSON,
        )

    @app.exception_handler(LockViolationError)
    async def _lock_violation(request: Request, exc: LockViolationError) -> JSONResponse:
        # Đây là tín hiệu bị tấn công hoặc bị bug, không phải lỗi thường —
        # luôn log ở mức cảnh báo kèm permId để truy vết.
        log.warning("LOCK VIOLATION permId=%s reason=%s", exc.perm_id, exc.reason)
        return JSONResponse(
            status_code=403,
            content={
                "type": "https://ailegal.local/errors/lock_violation",
                "title": "Ghi vào vùng khoá",
                "status": 403,
                "detail": "Không được phép ghi vào vùng khoá của hợp đồng",
                "code": "lock_violation",
                "permId": exc.perm_id,
            },
            media_type=PROBLEM_JSON,
        )

    @app.exception_handler(PostcheckFailedError)
    async def _postcheck(request: Request, exc: PostcheckFailedError) -> JSONResponse:
        # Hậu kiểm hỏng = BUG CỦA CHÚNG TA. Không đổ cho người dùng, log đầy đủ.
        log.error(
            "HAU KIEM HONG — %d thay đổi ngoài vùng cho phép: %s",
            len(exc.diffs),
            [f"{d.part} {d.location}: {d.detail}" for d in exc.diffs[:5]],
        )
        return JSONResponse(
            status_code=500,
            content={
                "type": "https://ailegal.local/errors/postcheck_failed",
                "title": "Hậu kiểm tài liệu không đạt",
                "status": 500,
                "detail": (
                    "Thao tác đã bị huỷ vì hệ thống phát hiện thay đổi ngoài vùng "
                    "được phép sửa. Tài liệu giữ nguyên. Sự cố đã được ghi nhận."
                ),
                "code": "postcheck_failed",
            },
            media_type=PROBLEM_JSON,
        )

    @app.exception_handler(DocumentWriteError)
    async def _doc_write(request: Request, exc: DocumentWriteError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "type": "https://ailegal.local/errors/document_write_error",
                "title": "Không ghi được tài liệu",
                "status": 422,
                "detail": str(exc),
                "code": "document_write_error",
            },
            media_type=PROBLEM_JSON,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(str(p) for p in err["loc"][1:]), "message": err["msg"]}
            for err in exc.errors()
        ]
        first = fields[0]["message"] if fields else "Dữ liệu không hợp lệ"
        return JSONResponse(
            status_code=422,
            content={
                "type": "https://ailegal.local/errors/validation_error",
                "title": "Dữ liệu không hợp lệ",
                "status": 422,
                "detail": first,
                "code": "validation_error",
                "errors": fields,
            },
            media_type=PROBLEM_JSON,
        )
