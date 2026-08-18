"""
Stage 4 — hai điểm số. KHÔNG dùng LLM (bất biến B2).

    LLM không bao giờ được sinh ra con số.

Đây là hệ thống pháp chế: mỗi con số phải bảo vệ được trước Legal và trước
audit, nên phải deterministic, giải thích được, và tái lập được. Mọi hàm ở đây
trả về kèm `breakdown` — từng biến đầu vào và phần đóng góp của nó.

Hai chỉ số TÁCH BIỆT HOÀN TOÀN, không được trộn:

  AI Confidence  bản thân phân tích chắc chắn tới đâu.
                 Thấp = "AI không dám chắc", KHÔNG phải "hợp đồng xấu".
  Fairness       điều khoản cân bằng/có lợi tới đâu cho Công ty.

Trọng số để ở `ScoringWeights` — Legal chỉnh qua cấu hình, không sửa code
(yêu cầu mục 7.4).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from app.services.ai.aggregator import (
    MISSING_PROTECTION,
    PROTECTION,
    RED_FLAG,
    WARNING,
    Judgment,
    aggregate,
)


@dataclass(frozen=True)
class ScoringWeights:
    """
    Trọng số hiệu chỉnh được. Giá trị mặc định là ĐIỂM KHỞI ĐIỂM, không phải
    chân lý — phải hiệu chuẩn lại khi có golden set (câu hỏi B3).
    """

    # AI Confidence — bốn thành phần, tổng bằng 1
    w_coverage: float = 0.30  # bao nhiêu điều khoản tìm được chỗ trong hợp đồng
    w_match_quality: float = 0.25  # khớp chắc tới đâu
    w_self_confidence: float = 0.25  # model tự đánh giá
    w_agreement: float = 0.20  # rule và semantic có đồng thuận không

    # Trần khi thiếu điều kiện — nói thẳng bằng con số thay vì giả vờ chắc chắn
    cap_when_fallback: float = 40.0  # LLM chết, chỉ còn rule-based
    cap_when_no_checklist: float = 50.0  # chưa có checklist của Legal

    # Fairness — trừ điểm theo mức nghiêm trọng của điều khoản bị vi phạm
    penalty_red_flag: dict[str, float] = field(
        default_factory=lambda: {"block": 25.0, "warn_high": 12.0, "warn_low": 6.0}
    )
    penalty_warning: dict[str, float] = field(
        default_factory=lambda: {"block": 8.0, "warn_high": 5.0, "warn_low": 2.0}
    )
    penalty_missing: dict[str, float] = field(
        default_factory=lambda: {"block": 15.0, "warn_high": 8.0, "warn_low": 3.0}
    )
    bonus_protection: float = 2.0
    max_protection_bonus: float = 10.0

    @classmethod
    def from_config(cls, raw: dict[str, Any] | None) -> ScoringWeights:
        """Nạp trọng số từ cấu hình của Legal; thiếu khoá nào thì dùng mặc định."""
        if not raw:
            return cls()
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in raw.items() if k in known})


@dataclass(frozen=True)
class ScoreResult:
    ai_confidence: float
    fairness: float
    breakdown: dict[str, Any]


def compute(
    judgments: list[Judgment],
    *,
    total_clauses: int,
    is_fallback: bool = False,
    has_checklist: bool = True,
    calibrated: bool = False,
    weights: ScoringWeights | None = None,
) -> ScoreResult:
    w = weights or ScoringWeights()
    graded = [j for j in judgments if j.verdict != "not_applicable"]

    confidence, conf_parts = _confidence(
        graded,
        total_clauses=total_clauses,
        is_fallback=is_fallback,
        has_checklist=has_checklist,
        w=w,
    )
    fairness, fair_parts = _fairness(graded, w=w)

    return ScoreResult(
        ai_confidence=confidence,
        fairness=fairness,
        breakdown={
            "aiConfidence": conf_parts,
            "fairness": fair_parts,
            "calibrated": calibrated,
            "isFallback": is_fallback,
            "hasChecklist": has_checklist,
            "weights": asdict(w),
            "gradedClauses": len(graded),
            "notApplicable": len(judgments) - len(graded),
        },
    )


def _confidence(
    judgments: list[Judgment],
    *,
    total_clauses: int,
    is_fallback: bool,
    has_checklist: bool,
    w: ScoringWeights,
) -> tuple[float, dict[str, Any]]:
    if total_clauses <= 0:
        return 0.0, {"reason": "chưa có điều khoản nào trong checklist", "value": 0.0}

    found = [j for j in judgments if j.verdict != "missing"]
    coverage = len(found) / total_clauses

    match_quality = _mean([j.match_score for j in found]) if found else 0.0
    self_confidence = _mean([j.self_confidence for j in judgments]) if judgments else 0.0

    # Đồng thuận: tỷ lệ phán quyết có cả hai tầng cùng chỉ về một chỗ.
    # `source == "rule"` nghĩa là LLM không tham gia → không tính là đồng thuận.
    from_both = [j for j in judgments if j.source == "llm" and j.match_score > 0]
    agreement = len(from_both) / len(judgments) if judgments else 0.0

    raw = 100 * (
        w.w_coverage * coverage
        + w.w_match_quality * match_quality
        + w.w_self_confidence * self_confidence
        + w.w_agreement * agreement
    )

    caps: list[tuple[str, float]] = []
    if is_fallback:
        caps.append(("LLM không dùng được, chỉ còn tầng rule-based", w.cap_when_fallback))
    if not has_checklist:
        caps.append(("chưa có checklist của Legal cho loại HĐ này", w.cap_when_no_checklist))

    value = round(min([raw] + [c for _, c in caps]), 1)
    return value, {
        "value": value,
        "rawBeforeCap": round(raw, 1),
        "coverage": round(coverage, 3),
        "matchQuality": round(match_quality, 3),
        "selfConfidence": round(self_confidence, 3),
        "agreement": round(agreement, 3),
        "caps": [{"reason": r, "cap": c} for r, c in caps],
        "clausesFound": len(found),
        "clausesTotal": total_clauses,
    }


def _fairness(judgments: list[Judgment], *, w: ScoringWeights) -> tuple[float, dict[str, Any]]:
    buckets = aggregate(judgments)

    def _sum(group: str, table: dict[str, float]) -> tuple[float, list[dict[str, Any]]]:
        total = 0.0
        detail = []
        for j in buckets[group]:
            amount = table.get(_severity(j), 0.0)
            total += amount
            detail.append({"clause": j.clause_code, "severity": j.severity, "amount": amount})
        return total, detail

    red, red_detail = _sum(RED_FLAG, w.penalty_red_flag)
    warn, warn_detail = _sum(WARNING, w.penalty_warning)
    miss, miss_detail = _sum(MISSING_PROTECTION, w.penalty_missing)

    bonus = min(len(buckets[PROTECTION]) * w.bonus_protection, w.max_protection_bonus)
    value = round(max(0.0, min(100.0, 100 - red - warn - miss + bonus)), 1)

    return value, {
        "value": value,
        "start": 100,
        "redFlagPenalty": round(red, 1),
        "warningPenalty": round(warn, 1),
        "missingPenalty": round(miss, 1),
        "protectionBonus": round(bonus, 1),
        "counts": {group: len(items) for group, items in buckets.items()},
        "details": {
            "redFlags": red_detail,
            "warnings": warn_detail,
            "missingProtections": miss_detail,
        },
    }


def _severity(judgment: Judgment) -> str:
    return {"high": "warn_high", "low": "warn_low"}.get(judgment.severity, judgment.severity)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0
