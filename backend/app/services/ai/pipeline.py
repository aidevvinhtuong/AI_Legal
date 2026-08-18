"""
Điều phối pipeline AI — Stage 0 → 5.

    0    Ingestion        đoạn văn bản + vùng mở/khoá (do services/document lo)
    0.5  Consistency      rule deterministic, KHÔNG LLM
    1    Clause matching  rule + dense + BM25 + rerank, KHÔNG LLM
    2    Judgment         LLM, guided JSON, mỗi điều khoản một lần gọi
    3    Aggregation      bảng tra → 4 nhóm, KHÔNG LLM
    4    Scoring          2 điểm số deterministic, KHÔNG LLM
    5    Narrative        LLM chỉ viết diễn giải, KHÔNG sinh con số

Bốn trong sáu stage không dùng LLM. Đó là chủ ý: phần nào tính được bằng code
thì không giao cho mô hình, vì code giải thích được và tái lập được.

Toàn bộ module là thư viện thuần — nhận `ChatModel`/`Embedder`/`Reranker` từ
ngoài, nên test được offline bằng client giả.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.services.ai import injection_guard
from app.services.ai.aggregator import Judgment, aggregate
from app.services.ai.consistency import ConsistencyIssue
from app.services.ai.consistency import run_all as run_consistency
from app.services.ai.matcher import ClauseMatch, Segment, match, match_rule_only
from app.services.ai.ports import ChatModel, Embedder, Reranker, UsageTally
from app.services.ai.schemas import NARRATIVE
from app.services.ai.scorer import ScoreResult, ScoringWeights, compute

log = logging.getLogger("ailegal.ai.pipeline")


@dataclass
class PipelineResult:
    judgments: list[Judgment] = field(default_factory=list)
    consistency: list[ConsistencyIssue] = field(default_factory=list)
    injections: list[injection_guard.InjectionFinding] = field(default_factory=list)
    scores: ScoreResult | None = None
    ai_summary: str = ""
    fairness_notes: str = ""
    usage: UsageTally = field(default_factory=UsageTally)
    is_fallback: bool = False
    fallback_reason: str = ""
    matches: list[ClauseMatch] = field(default_factory=list)

    @property
    def groups(self) -> dict[str, list[Judgment]]:
        return aggregate(self.judgments)


def run(
    *,
    segments: list[Segment],
    clauses: list[dict[str, Any]],
    contract_type: str,
    model: ChatModel | None,
    embedder: Embedder | None,
    reranker: Reranker | None = None,
    judge_prompt: str = "",
    narrative_prompt: str = "",
    weights: ScoringWeights | None = None,
    dense_weight: float = 0.65,
    bm25_weight: float = 0.35,
    threshold: float = 0.45,
    self_consistency_runs: int = 3,
) -> PipelineResult:
    """
    Chạy trọn pipeline. Không bao giờ ném ra ngoài: mọi hỏng hóc của dịch vụ
    ngoài đều rơi về đường rule-based và được đánh dấu `is_fallback` (NFR-R1).
    """
    result = PipelineResult()

    # ── Stage 0.5 — rule deterministic, luôn chạy, không phụ thuộc mạng ────
    open_fields = [
        (s.perm_id or s.id, s.numbering_label or "", s.text) for s in segments if s.is_open
    ]
    result.consistency = run_consistency(open_fields)
    result.injections = injection_guard.scan_fields([(f[0], f[2]) for f in open_fields])

    if not clauses:
        # Chưa có checklist: vẫn trả kết quả tầng rule, nêu rõ là tham khảo
        result.scores = compute(
            [], total_clauses=0, is_fallback=False, has_checklist=False, weights=weights
        )
        result.ai_summary = (
            "Chưa có checklist của Legal cho loại hợp đồng này. Kết quả chỉ gồm "
            "kiểm tra nhất quán tự động và mang tính tham khảo."
        )
        return result

    # ── Stage 1 — matching ────────────────────────────────────────────────
    try:
        if embedder is None:
            raise RuntimeError("không có embedder")
        result.matches = match(
            clauses,
            segments,
            embedder=embedder,
            reranker=reranker,
            dense_weight=dense_weight,
            bm25_weight=bm25_weight,
            threshold=threshold,
        )
    except Exception as e:
        log.warning("matching ngữ nghĩa hỏng, dùng rule-based: %s", e)
        result.is_fallback = True
        result.fallback_reason = f"Không dùng được embedding: {e}"
        result.matches = match_rule_only(clauses, segments)

    # ── Stage 2 — phán xét ────────────────────────────────────────────────
    if model is None:
        result.is_fallback = True
        result.fallback_reason = result.fallback_reason or "Không có mô hình ngôn ngữ"
        result.judgments = _rule_judgments(result.matches)
    else:
        from app.services.ai.judge import judge_all

        result.judgments = judge_all(
            result.matches,
            model=model,
            system_prompt=judge_prompt,
            contract_type=contract_type,
            usage=result.usage,
            self_consistency_for_block=self_consistency_runs,
        )
        # Tất cả đều hỏng ⇒ coi như không có LLM
        if result.judgments and all(j.source == "rule" for j in result.judgments):
            result.is_fallback = True
            result.fallback_reason = "Mô hình không phán xét được điều khoản nào"

    # Kết quả kiểm tra nhất quán bổ sung vào cùng bốn nhóm
    result.judgments.extend(_consistency_judgments(result.consistency))
    result.judgments.extend(_injection_judgments(result.injections))

    # ── Stage 4 — điểm số ─────────────────────────────────────────────────
    result.scores = compute(
        result.judgments,
        total_clauses=len(clauses),
        is_fallback=result.is_fallback,
        has_checklist=True,
        weights=weights,
    )

    # ── Stage 5 — diễn giải ───────────────────────────────────────────────
    if model is not None and narrative_prompt:
        _narrate(result, model=model, system_prompt=narrative_prompt, contract_type=contract_type)
    if not result.ai_summary:
        result.ai_summary = _default_summary(result)

    return result


def _narrate(
    result: PipelineResult, *, model: ChatModel, system_prompt: str, contract_type: str
) -> None:
    """
    LLM chỉ viết lời, KHÔNG sinh số (bất biến B2).

    Schema `NARRATIVE` không có trường số nào, nên guided decoding chặn ngay ở
    tầng sinh token — không phải trông chờ model tự giữ kỷ luật.
    """
    buckets = result.groups
    lines = [f"Loại hợp đồng: {contract_type}", "", "KẾT QUẢ RÀ SOÁT ĐÃ CÓ:"]
    for group, items in buckets.items():
        lines.append(f"\n{group} ({len(items)}):")
        for judgment in items[:8]:
            lines.append(
                f"  - [{judgment.clause_code}] {judgment.clause_name}: {judgment.rationale[:200]}"
            )
    lines.append(
        "\nHãy viết tóm tắt và nhận định cân bằng bằng tiếng Việt cho người đọc "
        "nghiệp vụ. TUYỆT ĐỐI không nêu điểm số hay phần trăm — điểm số do hệ "
        "thống tính riêng."
    )

    try:
        output = model.chat(
            system=system_prompt,
            user="\n".join(lines),
            json_schema=NARRATIVE,
            schema_name="narrative",
            temperature=0.3,  # stage duy nhất được phép > 0
            max_tokens=1200,
        )
        result.usage.add(output)
        if output.data:
            result.ai_summary = str(output.data.get("ai_summary") or "").strip()
            result.fairness_notes = str(output.data.get("fairness_notes") or "").strip()
    except Exception as e:
        log.warning("stage tóm tắt hỏng: %s", e)
        result.usage.errors.append(f"narrative: {e}")


def _rule_judgments(matches: list[ClauseMatch]) -> list[Judgment]:
    from app.services.ai.judge import _missing, _rule_only

    return [(_rule_only(m) if m.found else _missing(m)) for m in matches]


def _consistency_judgments(issues: list[ConsistencyIssue]) -> list[Judgment]:
    """
    Đưa phát hiện của tầng rule vào cùng mô hình phán quyết.

    `severity` ánh xạ sang thang của checklist để bảng tra nhóm dùng được chung —
    không có đường xử lý riêng cho rule và cho LLM.
    """
    mapping = {"block": "block", "high": "warn_high", "low": "warn_low"}
    out: list[Judgment] = []
    for issue in issues:
        out.append(
            Judgment(
                clause_code=f"RULE-{issue.rule}",
                clause_name=issue.title,
                kind="required",
                severity=mapping.get(issue.severity, "warn_high"),
                verdict="below_fallback" if issue.group != "missing_protection" else "missing",
                rationale=issue.description,
                evidence_quote=issue.evidence,
                field_id=issue.field_id,
                self_confidence=1.0,  # deterministic — đúng 100%
                source="rule",
                match_score=1.0,
            )
        )
    return out


def _injection_judgments(findings: list[injection_guard.InjectionFinding]) -> list[Judgment]:
    """Quyết định B6: gắn Red Flag và VẪN tiếp tục rà soát, không dừng."""
    return [
        Judgment(
            clause_code=f"SEC-{f.pattern}",
            clause_name=f.title,
            kind="forbidden",
            severity="block",
            verdict="red_line_violation",
            rationale=f.description,
            evidence_quote=f.excerpt,
            field_id=f.field_id,
            self_confidence=1.0,
            source="rule",
            match_score=1.0,
        )
        for f in findings
    ]


def _default_summary(result: PipelineResult) -> str:
    buckets = result.groups
    parts = [
        f"Rà soát {len(result.judgments)} điều khoản: "
        f"{len(buckets['red_flag'])} vấn đề nghiêm trọng, "
        f"{len(buckets['warning'])} cảnh báo, "
        f"{len(buckets['missing_protection'])} thiếu sót, "
        f"{len(buckets['protection'])} điều khoản đang bảo vệ Công ty."
    ]
    if result.is_fallback:
        parts.append(
            f"Lưu ý: kết quả chạy ở chế độ dự phòng ({result.fallback_reason}) — "
            "độ tin cậy thấp hơn bình thường, cần người rà soát kỹ."
        )
    return " ".join(parts)
