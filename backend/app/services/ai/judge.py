"""
Stage 2 — phán xét từng điều khoản. MỘT lần gọi LLM cho MỘT điều khoản.

Vì sao không nhồi cả tài liệu vào một prompt:

  - Mỗi phát hiện truy vết được về đúng một điều khoản và đúng một lần gọi.
  - Prompt ngắn thì model chính xác hơn hẳn.
  - Lỗi cục bộ không phá cả kết quả — một điều khoản hỏng thì rơi về rule-based,
    các điều khoản còn lại vẫn có phán quyết đầy đủ.

Tài liệu chỉ ~23K ký tự nên hiệu năng không phải lý do (PH-8); lý do là **truy
vết được** và **chính xác**.
"""

from __future__ import annotations

import logging
from typing import Any

from app.services.ai.aggregator import Judgment
from app.services.ai.injection_guard import wrap_untrusted
from app.services.ai.matcher import ClauseMatch
from app.services.ai.ports import ChatModel, UsageTally
from app.services.ai.schemas import CLAUSE_JUDGMENT, VERDICTS

log = logging.getLogger("ailegal.ai.judge")

MAX_EVIDENCE_CHARS = 6000


def judge_all(
    matches: list[ClauseMatch],
    *,
    model: ChatModel,
    system_prompt: str,
    contract_type: str,
    usage: UsageTally,
    self_consistency_for_block: int = 1,
) -> list[Judgment]:
    """
    Phán xét toàn bộ. Điều khoản không tìm thấy đoạn nào thì KHÔNG gọi LLM —
    kết luận `missing` là hiển nhiên và gọi thêm chỉ tốn tiền.
    """
    out: list[Judgment] = []
    for item in matches:
        if not item.found:
            out.append(_missing(item))
            continue

        runs = self_consistency_for_block if str(item.clause.get("severity")) == "block" else 1
        try:
            out.append(
                _judge_one(
                    item,
                    model=model,
                    system_prompt=system_prompt,
                    contract_type=contract_type,
                    usage=usage,
                    runs=max(1, runs),
                )
            )
        except Exception as e:
            log.warning("phán xét điều khoản %s lỗi: %s", item.clause.get("code"), e)
            usage.errors.append(f"{item.clause.get('code')}: {e}")
            out.append(_rule_only(item))
    return out


def _judge_one(
    item: ClauseMatch,
    *,
    model: ChatModel,
    system_prompt: str,
    contract_type: str,
    usage: UsageTally,
    runs: int,
) -> Judgment:
    best = item.best
    assert best is not None

    user = _build_user_prompt(item, contract_type=contract_type)

    verdicts: list[dict[str, Any]] = []
    for _ in range(runs):
        result = model.chat(
            system=system_prompt,
            user=user,
            json_schema=CLAUSE_JUDGMENT,
            schema_name="clause_judgment",
            temperature=0.0,
            max_tokens=1500,
        )
        usage.add(result)
        if result.data:
            verdicts.append(result.data)

    if not verdicts:
        return _rule_only(item)

    data = _consensus(verdicts)
    clause = item.clause
    verdict = str(data.get("verdict") or "")
    if verdict not in VERDICTS:
        verdict = "below_fallback"

    # Chỉ nhận đề xuất câu chữ khi đoạn đó THẬT SỰ là vùng mở. Model có thể đề
    # xuất cho vùng khoá; lọc ở đây để nó không bao giờ tới được tầng ghi.
    proposed = str(data.get("proposed_text") or "").strip()
    if not best.segment.is_open:
        proposed = ""

    return Judgment(
        clause_code=str(clause.get("code") or ""),
        clause_name=str(clause.get("name") or ""),
        kind=str(clause.get("kind") or "required"),
        severity=str(clause.get("severity") or "warn_high"),
        verdict=verdict,
        rationale=str(data.get("rationale") or "").strip(),
        evidence_quote=str(data.get("evidence_quote") or "").strip(),
        proposed_text=proposed,
        self_confidence=_clamp(data.get("self_confidence")),
        field_id=best.segment.perm_id if best.segment.is_open else None,
        source="llm",
        match_score=best.score,
        injection_suspected=bool(data.get("injection_suspected")),
    )


def _build_user_prompt(item: ClauseMatch, *, contract_type: str) -> str:
    """
    Prompt người dùng = điều khoản của Legal + đoạn văn bản ứng viên.

    Nội dung hợp đồng LUÔN nằm trong delimiter và được tuyên bố là dữ liệu
    (chống prompt injection ở tầng kiến trúc).
    """
    clause = item.clause
    lines = [
        f"Loại hợp đồng: {contract_type}",
        "",
        "ĐIỀU KHOẢN CẦN RÀ SOÁT (do Legal ban hành):",
        f"- Mã: {clause.get('code')}",
        f"- Tên: {clause.get('name')}",
        f"- Loại: {clause.get('kind')} · Mức nghiêm trọng: {clause.get('severity')}",
    ]
    for label, key in (
        ("Chuẩn mong muốn (Ideal)", "standardText"),
        ("Phương án chấp nhận được (Fallback)", "fallback"),
        ("Ngưỡng không được vượt (Red Line)", "redLine"),
        ("Lý do nghiệp vụ", "rationale"),
    ):
        value = str(clause.get(key) or "").strip()
        if value:
            lines.append(f"- {label}: {value}")

    lines += ["", "ĐOẠN VĂN BẢN ỨNG VIÊN TRONG HỢP ĐỒNG:"]
    for rank, candidate in enumerate(item.candidates, start=1):
        state = (
            "VÙNG MỞ — được phép đề xuất sửa"
            if candidate.segment.is_open
            else "VÙNG KHOÁ — chỉ được cảnh báo"
        )
        lines.append(f"[{rank}] {candidate.segment.display} ({state})")
        lines.append(wrap_untrusted(candidate.segment.text[:MAX_EVIDENCE_CHARS]))
        lines.append("")

    lines.append(
        "Hãy phán xét điều khoản này. Nếu đoạn nằm trong VÙNG KHOÁ thì để "
        "`proposed_text` rỗng. Nếu vượt Red Line thì KHÔNG đề xuất câu chữ thay thế."
    )
    return "\n".join(lines)


def _consensus(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Nhiều lần chạy cho điều khoản `block`: lấy phán quyết chiếm đa số.

    Hoà thì chọn phán quyết NGHIÊM KHẮC HƠN — với điều khoản mức chặn, báo thừa
    rẻ hơn bỏ sót (rủi ro R1).
    """
    if len(runs) == 1:
        return runs[0]

    order = {v: i for i, v in enumerate(VERDICTS)}
    counts: dict[str, int] = {}
    for run in runs:
        verdict = str(run.get("verdict") or "")
        counts[verdict] = counts.get(verdict, 0) + 1

    top = max(counts.values())
    tied = [v for v, c in counts.items() if c == top]
    # `VERDICTS` xếp từ tốt tới xấu, nên chỉ số lớn hơn = nghiêm khắc hơn
    chosen = max(tied, key=lambda v: order.get(v, 0))
    return next(r for r in runs if str(r.get("verdict")) == chosen)


def _missing(item: ClauseMatch) -> Judgment:
    clause = item.clause
    return Judgment(
        clause_code=str(clause.get("code") or ""),
        clause_name=str(clause.get("name") or ""),
        kind=str(clause.get("kind") or "required"),
        severity=str(clause.get("severity") or "warn_high"),
        verdict="missing",
        rationale="Không tìm thấy đoạn nào trong hợp đồng tương ứng điều khoản này.",
        self_confidence=0.6,
        source="rule",
    )


def _rule_only(item: ClauseMatch) -> Judgment:
    """Có đoạn khớp nhưng LLM không phán xét được — nêu ra để người đọc tự kiểm."""
    best = item.best
    clause = item.clause
    return Judgment(
        clause_code=str(clause.get("code") or ""),
        clause_name=str(clause.get("name") or ""),
        kind=str(clause.get("kind") or "required"),
        severity=str(clause.get("severity") or "warn_high"),
        verdict="below_fallback",
        rationale=(
            "Tìm thấy đoạn liên quan nhưng chưa phán xét được bằng mô hình — "
            "cần người rà soát thủ công."
        ),
        evidence_quote=best.segment.text[:300] if best else "",
        self_confidence=0.2,
        field_id=best.segment.perm_id if best and best.segment.is_open else None,
        source="rule",
        match_score=best.score if best else 0.0,
    )


def _clamp(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0
