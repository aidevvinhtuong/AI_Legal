"""
System Prompt — hành vi AI, thuộc IT (tách khỏi checklist pháp lý của Legal).

Nguồn sự thật là thư mục Git `/prompts/<stage>/` + `current.json` trỏ file đang
dùng (ràng buộc C-11). UI chỉ sửa file CURRENT.

**Điểm phải nói rõ với vận hành:** ghi qua UI là ghi thẳng vào file trong
container. Nếu thư mục `/prompts` không được mount ra ngoài và commit ngược lại
Git thì lần deploy sau sẽ ghi đè mất. Đây là khoảng trống quy trình, không phải
lỗi code — xem ghi chú trong `docker-compose.prod.yml`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, require
from app.domain.enums import Permission
from app.domain.errors import NotFoundError, ValidationError
from app.infra.models import AuditLog
from app.infra.settings import get_settings

router = APIRouter(
    prefix="/api/v1/system-prompts",
    tags=["system-prompts"],
    dependencies=[Depends(require(Permission.SYSTEM_PROMPTS))],
)

# Blueprint v1.17 bỏ stage `field_validation` — còn đúng ba stage
STAGES = ("checklist_review", "chat_edit", "ai_summary_fairness")
SHARED_GUARD = "_shared/injection_guard.md"

# Placeholder hợp lệ của từng stage. Prompt dùng placeholder lạ là dấu hiệu
# soạn nhầm — chặn ngay lúc lưu, đừng để phát hiện khi chạy AI thật.
STAGE_PLACEHOLDERS: dict[str, set[str]] = {
    "checklist_review": {"contract_type", "checklist_items", "document_text"},
    "chat_edit": {
        "contract_type",
        "checklist_items",
        "conversation_history",
        "current_document_state",
    },
    "ai_summary_fairness": {"contract_type", "findings", "approval_matrix_context"},
}

# Nội dung pháp lý KHÔNG được nằm trong prompt (ràng buộc C-12) — nó thuộc
# checklist của Legal, inject qua {{checklist_items}}.
HARDCODED_LEGAL = (
    r"\b\d+\s*(ngày|tháng|năm)\b",
    r"\b\d+(\.\d+)?\s*%",
    r"\bĐiều\s+\d+",
)


def _root() -> Path:
    return Path(get_settings().PROMPTS_DIR).resolve()


def _current_file(stage: str) -> Path:
    folder = _root() / stage
    pointer = folder / "current.json"
    if not pointer.exists():
        raise NotFoundError(f"Stage “{stage}” (thiếu current.json)")
    try:
        data = json.loads(pointer.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValidationError(f"current.json của “{stage}” hỏng: {e}") from e
    # Repo dùng khoá `file`; chấp nhận cả `current` để không phụ thuộc một cách viết
    name = data.get("file") or data.get("current")
    if not name:
        raise ValidationError(f"current.json của “{stage}” không trỏ file nào")
    return folder / name


@router.get("")
def list_prompts(principal: CurrentUser) -> dict[str, Any]:
    del principal
    prompts = []
    for stage in STAGES:
        try:
            path = _current_file(stage)
            body = path.read_text(encoding="utf-8") if path.exists() else ""
            prompts.append(
                {
                    "stage": stage,
                    "fileName": path.name,
                    "content": body,
                    "placeholders": sorted(STAGE_PLACEHOLDERS[stage]),
                    "updatedAt": (
                        __import__("datetime")
                        .datetime.fromtimestamp(path.stat().st_mtime)
                        .isoformat()
                        if path.exists()
                        else None
                    ),
                }
            )
        except (NotFoundError, ValidationError) as e:
            prompts.append({"stage": stage, "error": str(e), "content": ""})
    return {"prompts": prompts}


class PromptIn(BaseModel):
    stage: str = Field(min_length=1)
    content: str


@router.put("")
def save_prompt(payload: PromptIn, principal: CurrentUser, db: DbSession) -> dict[str, Any]:
    if payload.stage not in STAGES:
        raise ValidationError(
            f"Stage “{payload.stage}” không hợp lệ ({', '.join(STAGES)})", code="unknown_stage"
        )

    _validate(payload.stage, payload.content)

    path = _current_file(payload.stage)
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    path.write_text(payload.content, encoding="utf-8")

    db.add(
        AuditLog(
            actor_id=principal.user_id,
            actor_name=principal.username,
            actor_role=principal.role.value,
            action="update_system_prompt",
            entity_type="system_prompt",
            entity_id=payload.stage,
            old_value={"length": len(old)},
            new_value={"length": len(payload.content), "file": path.name},
        )
    )
    return {"prompt": {"stage": payload.stage, "fileName": path.name, "content": payload.content}}


def _validate(stage: str, content: str) -> None:
    import re

    allowed = STAGE_PLACEHOLDERS[stage]
    used = set(re.findall(r"\{\{\s*(\w+)\s*\}\}", content))
    unknown = sorted(used - allowed)
    if unknown:
        names = ", ".join("{{" + u + "}}" for u in unknown)
        raise ValidationError(
            f"Placeholder không hợp lệ cho stage này: {names}. "
            f"Được dùng: {', '.join(sorted(allowed))}",
            code="unknown_placeholder",
        )

    for pattern in HARDCODED_LEGAL:
        match = re.search(pattern, content)
        if match:
            raise ValidationError(
                f"Prompt chứa nội dung pháp lý cứng: “{match.group(0)}”. "
                "Ngưỡng và điều khoản thuộc checklist của Legal, "
                "phải inject qua {{checklist_items}} (ràng buộc C-12).",
                code="hardcoded_legal_content",
            )
