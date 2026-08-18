"""
Stage 3 — quy phán quyết về 4 nhóm hiển thị. KHÔNG dùng LLM.

Bảng tra `(kind × severity × verdict) → group` phải **tường minh** chứ không
phải chuỗi if lồng nhau: Legal cần đọc được vì sao một điều khoản rơi vào Red
Flag, và ta cần chỉ vào đúng một dòng để giải thích.

Nguyên tắc xếp nhóm:

  red_flag            việc phải sửa trước khi trình ký
  warning             dưới chuẩn nhưng chấp nhận được, cần người quyết
  protection          điều khoản đang bảo vệ Công ty — nêu ra để thấy mặt tốt
  missing_protection  thiếu một lớp bảo vệ đáng lẽ nên có

Hai lựa chọn dễ gây tranh cãi, nói rõ ở đây:

  - `red_line_violation` LUÔN là red_flag, kể cả với điều khoản severity thấp.
    Red Line là ngưỡng walk-away do Legal đặt; vượt nó thì mức nghiêm trọng của
    điều khoản không còn là yếu tố giảm nhẹ.
  - `missing` của điều khoản **kind=forbidden** là `protection`, không phải
    thiếu sót: điều bị cấm mà không xuất hiện trong hợp đồng là điều tốt.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

RED_FLAG = "red_flag"
WARNING = "warning"
PROTECTION = "protection"
MISSING_PROTECTION = "missing_protection"

# `None` = không hiển thị (not_applicable)
Group = str | None

KINDS = ("required", "forbidden", "recommended")
SEVERITIES = ("block", "warn_high", "warn_low")


def _table() -> dict[tuple[str, str, str], Group]:
    """Bảng tra đầy đủ. Sinh bằng vòng lặp nhưng mọi ô đều xác định tường minh."""
    table: dict[tuple[str, str, str], Group] = {}
    for kind in KINDS:
        for severity in SEVERITIES:
            table[(kind, severity, "not_applicable")] = None
            table[(kind, severity, "red_line_violation")] = RED_FLAG
            table[(kind, severity, "ideal_met")] = PROTECTION

            # Đạt Fallback = dưới chuẩn Ideal nhưng Legal đã chấp nhận trước
            table[(kind, severity, "fallback_met")] = WARNING if severity == "block" else PROTECTION

            table[(kind, severity, "below_fallback")] = RED_FLAG if severity == "block" else WARNING

            if kind == "forbidden":
                # Điều bị cấm KHÔNG xuất hiện ⇒ đúng ý Legal
                table[(kind, severity, "missing")] = PROTECTION
            elif kind == "required":
                table[(kind, severity, "missing")] = (
                    RED_FLAG if severity == "block" else MISSING_PROTECTION
                )
            else:  # recommended
                table[(kind, severity, "missing")] = MISSING_PROTECTION
    return table


GROUP_TABLE = _table()


@dataclass(frozen=True)
class Judgment:
    """Phán quyết cho một điều khoản, sau khi đã hợp nhất rule + LLM."""

    clause_code: str
    clause_name: str
    kind: str
    severity: str
    verdict: str
    rationale: str = ""
    evidence_quote: str = ""
    proposed_text: str = ""
    self_confidence: float = 0.0
    field_id: str | None = None  # permId nếu neo được vào vùng mở
    source: str = "llm"  # llm | rule
    match_score: float = 0.0
    injection_suspected: bool = False

    @property
    def group(self) -> Group:
        return GROUP_TABLE.get(
            (_norm_kind(self.kind), _norm_severity(self.severity), self.verdict), WARNING
        )

    @property
    def is_type_a(self) -> bool:
        """
        Loại A = ghi được vào tài liệu.

        Cần đủ ba điều: neo được vào vùng mở, có câu chữ đề xuất, và KHÔNG vượt
        Red Line — vượt Red Line thì AI chỉ được cảnh báo, không được tự viết
        thay (TS-05 Stage 2).
        """
        return bool(
            self.field_id and self.proposed_text.strip() and self.verdict != "red_line_violation"
        )


def _norm_kind(value: str) -> str:
    return value if value in KINDS else "required"


def _norm_severity(value: str) -> str:
    if value in SEVERITIES:
        return value
    # FE từng dùng "high"/"low" — chấp nhận cả hai cách viết
    return {"high": "warn_high", "low": "warn_low"}.get(value, "warn_high")


def group_of(kind: str, severity: str, verdict: str) -> Group:
    return GROUP_TABLE.get((_norm_kind(kind), _norm_severity(severity), verdict), WARNING)


def aggregate(judgments: list[Judgment]) -> dict[str, list[Judgment]]:
    """Chia phán quyết vào 4 nhóm; bỏ những cái `not_applicable`."""
    buckets: dict[str, list[Judgment]] = {
        RED_FLAG: [],
        WARNING: [],
        PROTECTION: [],
        MISSING_PROTECTION: [],
    }
    for judgment in judgments:
        group = judgment.group
        if group is not None:
            buckets[group].append(judgment)
    return buckets


def explain(kind: str, severity: str, verdict: str) -> str:
    """Câu giải thích cho UI và cho audit — vì sao rơi vào nhóm này."""
    group = group_of(kind, severity, verdict)
    if group is None:
        return "Điều khoản không áp dụng cho hợp đồng này."
    reasons = {
        RED_FLAG: "phải xử lý trước khi trình ký",
        WARNING: "dưới chuẩn nhưng vẫn trong ngưỡng Legal chấp nhận",
        PROTECTION: "điều khoản đang bảo vệ Công ty",
        MISSING_PROTECTION: "thiếu một lớp bảo vệ nên có",
    }
    return f"Điều khoản {kind}/{severity} với phán quyết “{verdict}” → {group}: {reasons[group]}."


def to_dict(judgment: Judgment) -> dict[str, Any]:
    return {
        "clauseCode": judgment.clause_code,
        "title": judgment.clause_name,
        "description": judgment.rationale,
        "severity": judgment.severity,
        "verdict": judgment.verdict,
        "relatedFieldId": judgment.field_id,
        "evidence": judgment.evidence_quote,
        "source": judgment.source,
    }
