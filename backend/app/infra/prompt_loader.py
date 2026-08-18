"""
Nạp System Prompt từ thư mục Git.

Nguồn sự thật: `/prompts/<stage>/current.json` trỏ file `vN.md` đang dùng
(ràng buộc C-11). Mỗi lần gọi LLM, backend LUÔN ghép:

    prompts/_shared/injection_guard.md  +  "---"  +  body của stage

`version` trả về là hash của **nội dung đã ghép**, ghi vào `ai_runs.prompt_version`.
Hash chứ không phải tên file: đổi nội dung mà quên đổi tên file thì vẫn phân biệt
được — điều kiện để giải thích một kết luận AI sáu tháng sau.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path

from app.infra.settings import get_settings

log = logging.getLogger("ailegal.prompts")

GUARD_PATH = "_shared/injection_guard.md"
SEPARATOR = "\n\n---\n\n"


@dataclass(frozen=True)
class LoadedPrompt:
    stage: str
    content: str
    file_name: str
    version: str

    @property
    def ok(self) -> bool:
        return bool(self.content.strip())


def load(stage: str) -> LoadedPrompt:
    """
    Nạp prompt của một stage. Thiếu file KHÔNG ném lỗi — pipeline phải chạy
    được ở chế độ dự phòng thay vì sập cả review (NFR-R1).
    """
    root = Path(get_settings().PROMPTS_DIR)
    guard = _read(root / GUARD_PATH)

    folder = root / stage
    file_name = ""
    body = ""
    pointer = folder / "current.json"

    if pointer.exists():
        try:
            data = json.loads(pointer.read_text(encoding="utf-8"))
            file_name = str(data.get("file") or data.get("current") or "")
        except (json.JSONDecodeError, OSError) as e:
            log.warning("current.json của stage %s hỏng: %s", stage, e)

    if file_name:
        body = _read(folder / file_name)
    if not body:
        log.warning("không nạp được prompt cho stage %s", stage)

    content = f"{guard}{SEPARATOR}{body}" if guard and body else (body or guard)
    return LoadedPrompt(
        stage=stage,
        content=content,
        file_name=file_name,
        version=hashlib.sha256(content.encode("utf-8")).hexdigest()[:16],
    )


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
