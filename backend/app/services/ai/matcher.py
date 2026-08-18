"""
Stage 1 — ghép mỗi điều khoản checklist với đoạn văn bản tương ứng. KHÔNG dùng LLM.

Đây là bước quyết định chất lượng của cả pipeline: LLM chỉ giỏi khi được đưa
đúng đoạn để đọc. Đưa cả tài liệu vào một prompt thì vừa đắt, vừa khó truy vết,
vừa dễ bỏ sót.

Ba tầng cộng dồn:

    score = 0.65·cosine(dense) + 0.35·bm25_norm      (trọng số ở settings)
    + thưởng khi keyword/pattern của Legal khớp
    + rerank chọn lại thứ tự trong nhóm ứng viên đầu

Tầng rule-based (keywords/patterns) không chỉ để cộng điểm — nó còn là **đường
lui khi LLM chết**: `match_rule_only()` chạy được mà không cần mạng.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.services.ai.bm25 import Bm25Index, normalise
from app.services.ai.ports import Embedder, Reranker

KEYWORD_BONUS = 0.15
PATTERN_BONUS = 0.25
MAX_RULE_BONUS = 0.30


@dataclass(frozen=True)
class Segment:
    """Một đoạn văn bản ứng viên. `is_open` quyết định AI có được đề xuất sửa không."""

    id: str
    text: str
    is_open: bool = False
    perm_id: str | None = None
    numbering_label: str | None = None

    @property
    def display(self) -> str:
        return self.numbering_label or f"đoạn {self.id}"


@dataclass
class Candidate:
    segment: Segment
    score: float
    dense: float = 0.0
    lexical: float = 0.0
    rule_bonus: float = 0.0
    rerank: float | None = None
    matched_keywords: list[str] = field(default_factory=list)


@dataclass
class ClauseMatch:
    """Kết quả ghép của MỘT điều khoản. `candidates` rỗng ⇒ verdict = missing."""

    clause: dict[str, Any]
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None

    @property
    def found(self) -> bool:
        return bool(self.candidates)


def match_rule_only(clauses: list[dict[str, Any]], segments: list[Segment]) -> list[ClauseMatch]:
    """
    Chỉ dùng keywords/patterns của Legal — không gọi mạng.

    Dùng khi LLM/embedding chết (NFR-R1). Kém chính xác hơn nhiều, và kết quả
    phải được đánh dấu `is_fallback` để UI cảnh báo.
    """
    out: list[ClauseMatch] = []
    for clause in clauses:
        scored: list[Candidate] = []
        for segment in segments:
            bonus, hits = _rule_bonus(clause, segment.text)
            if bonus > 0:
                scored.append(
                    Candidate(
                        segment=segment,
                        score=bonus / MAX_RULE_BONUS,
                        rule_bonus=bonus,
                        matched_keywords=hits,
                    )
                )
        scored.sort(key=lambda c: c.score, reverse=True)
        out.append(ClauseMatch(clause=clause, candidates=scored[:3]))
    return out


def match(
    clauses: list[dict[str, Any]],
    segments: list[Segment],
    *,
    embedder: Embedder,
    reranker: Reranker | None = None,
    dense_weight: float = 0.65,
    bm25_weight: float = 0.35,
    threshold: float = 0.45,
    top_k: int = 3,
) -> list[ClauseMatch]:
    """
    Ghép đầy đủ ba tầng. Nhúng toàn bộ trong ít lần gọi nhất có thể: một lượt
    cho tất cả segment, một lượt cho tất cả clause.
    """
    if not clauses or not segments:
        return [ClauseMatch(clause=c) for c in clauses]

    segment_texts = [s.text for s in segments]
    clause_texts = [_clause_query(c) for c in clauses]

    vectors = embedder.embed(segment_texts + clause_texts)
    seg_vectors = vectors[: len(segments)]
    clause_vectors = vectors[len(segments) :]

    index = Bm25Index.build(segment_texts)

    out: list[ClauseMatch] = []
    for position, clause in enumerate(clauses):
        query = clause_texts[position]
        dense_scores = [_cosine(clause_vectors[position], v) for v in seg_vectors]
        lexical_scores = normalise(index.scores(query))

        candidates: list[Candidate] = []
        for i, segment in enumerate(segments):
            bonus, hits = _rule_bonus(clause, segment.text)
            total = dense_weight * dense_scores[i] + bm25_weight * lexical_scores[i] + bonus
            candidates.append(
                Candidate(
                    segment=segment,
                    score=round(min(total, 1.0), 4),
                    dense=round(dense_scores[i], 4),
                    lexical=round(lexical_scores[i], 4),
                    rule_bonus=round(bonus, 4),
                    matched_keywords=hits,
                )
            )

        candidates.sort(key=lambda c: c.score, reverse=True)
        shortlist = [c for c in candidates[: max(top_k * 3, 6)] if c.score >= threshold * 0.6]

        if reranker is not None and len(shortlist) > 1:
            order = reranker.rerank(query, [c.segment.text for c in shortlist], top_n=top_k * 2)
            reranked: list[Candidate] = []
            for idx, score in order:
                if 0 <= idx < len(shortlist):
                    item = shortlist[idx]
                    item.rerank = round(score, 4)
                    reranked.append(item)
            if reranked:
                shortlist = reranked

        kept = [c for c in shortlist if c.score >= threshold][:top_k]
        out.append(ClauseMatch(clause=clause, candidates=kept))

    return out


def _clause_query(clause: dict[str, Any]) -> str:
    """
    Câu truy vấn của một điều khoản.

    Ghép tên + văn bản chuẩn (Ideal): tên cho tín hiệu chủ đề, Ideal cho ngữ
    cảnh. Không đưa Red Line vào — nó mô tả điều KHÔNG mong muốn, đưa vào sẽ kéo
    truy vấn về đúng đoạn xấu.
    """
    parts = [str(clause.get("name") or ""), str(clause.get("standardText") or "")]
    return " ".join(p for p in parts if p).strip()[:2000]


def _rule_bonus(clause: dict[str, Any], text: str) -> tuple[float, list[str]]:
    """Thưởng khi khớp keyword/pattern do Legal khai. Có trần để không át tầng ngữ nghĩa."""
    lowered = text.lower()
    hits: list[str] = []
    bonus = 0.0

    for keyword in clause.get("keywords") or []:
        word = str(keyword).strip().lower()
        if word and word in lowered:
            bonus += KEYWORD_BONUS
            hits.append(word)

    for pattern in clause.get("patterns") or []:
        try:
            if re.search(str(pattern), text, re.IGNORECASE):
                bonus += PATTERN_BONUS
                hits.append(f"/{pattern}/")
        except re.error:
            # Regex do người dùng nhập — sai cú pháp thì bỏ qua, không làm hỏng review
            continue

    return min(bonus, MAX_RULE_BONUS), hits


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    # Cắt về [0,1]: cosine âm nghĩa là không liên quan, không phải "liên quan ngược"
    return max(0.0, dot / (na * nb))
