"""
Chạy pipeline AI cho một ticket và ghi kết quả xuống DB.

Đây là chỗ duy nhất nối `services/ai` (thư viện thuần) với thế giới thật: đọc
tài liệu, nạp checklist, dựng client, ghi `ai_runs` / `ai_findings` /
`ai_proposals`.

Mọi hỏng hóc của dịch vụ ngoài đều **không** làm hỏng ticket: pipeline tự rơi về
đường rule-based và đánh dấu `is_fallback`, UI hiện banner cảnh báo (NFR-R1 / B4).
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import ReviewStatus
from app.infra.models import (
    AiFinding,
    AiProposal,
    AiRun,
    ContractReview,
    DocumentField,
    ReviewFile,
    ReviewVersion,
)
from app.infra.prompt_loader import load as load_prompt
from app.infra.settings import get_settings
from app.services.ai import pipeline
from app.services.ai.aggregator import Judgment
from app.services.ai.matcher import Segment as MatchSegment
from app.services.ai.scorer import ScoringWeights
from app.services.ai.segmenter import segment as segment_document
from app.services.config import checklist
from app.services.document.model import ParagraphDescriptor
from app.services.document.ooxml import DocxPackage
from app.services.document.ooxml_reader import OoxmlReader
from app.services.review import versions
from app.services.storage.objects import get_storage

log = logging.getLogger("ailegal.ai.review")


def run_ai_review(db: Session, review: ContractReview) -> ContractReview:
    """
    Chạy AI review đầy đủ. Ghi đè kết quả cũ — mỗi lần chạy là một chu kỳ mới.

    Không ném exception ra ngoài: ticket phải kết thúc ở `reviewed` (có cảnh báo
    nếu chạy dự phòng) hoặc `failed` kèm lý do, chứ không được kẹt ở `processing`.
    """
    settings = get_settings()
    version = _current_version(db, review)

    try:
        segments = _load_segments(db, review, version)
    except Exception as e:
        log.exception("không đọc được tài liệu của %s", review.code)
        review.status = ReviewStatus.FAILED.value
        review.failure_reason = f"Không đọc được tệp hợp đồng: {e}"
        db.flush()
        return review

    merged = checklist.merge_for_contract_name(db, review.contract_type_id)
    judge_prompt = load_prompt("checklist_review")
    narrative_prompt = load_prompt("ai_summary_fairness")

    model, embedder, reranker, model_hash = _clients(merged)

    result = pipeline.run(
        segments=segments,
        clauses=merged.clauses,
        contract_type=review.contract_type_label or review.contract_type_id,
        model=model,
        embedder=embedder,
        reranker=reranker,
        judge_prompt=judge_prompt.content,
        narrative_prompt=narrative_prompt.content,
        weights=ScoringWeights.from_config((merged.ai_tiers or {}).get("scoringWeights")),
        dense_weight=settings.MATCH_DENSE_WEIGHT,
        bm25_weight=settings.MATCH_BM25_WEIGHT,
        threshold=settings.MATCH_THRESHOLD,
        self_consistency_runs=settings.SELF_CONSISTENCY_RUNS,
    )

    _persist(
        db,
        review,
        result,
        merged=merged,
        judge_prompt_version=judge_prompt.version,
        model_id=model.model if model else "rule-based",
        model_hash=model_hash,
    )
    return review


# ─────────────────────────────────────────────────────────────────────────────
def _clients(merged: checklist.MergedChecklist):
    """
    Dựng client. Tầng ngữ nghĩa tắt được từ cấu hình của Legal (`aiTiers`) —
    khi đó pipeline chỉ chạy rule-based mà KHÔNG bị coi là hỏng.
    """
    tiers = merged.ai_tiers or {}
    if not get_settings().AI_SEMANTIC_ENABLED or not tiers.get("semanticEnabled", True):
        return None, None, None, ""

    try:
        from app.infra.llm_client import LlmClient
        from app.infra.tei_client import EmbeddingClient, RerankClient

        model = LlmClient()
        return model, EmbeddingClient(), RerankClient(), model.model_fingerprint()
    except Exception as e:
        log.warning("không dựng được client model: %s", e)
        return None, None, None, ""


def _current_version(db: Session, review: ContractReview) -> ReviewVersion:
    """Version MANG TỆP đang có hiệu lực — xem `versions.current_document`."""
    return versions.current_document(db, review)


def _load_segments(
    db: Session, review: ContractReview, version: ReviewVersion
) -> list[MatchSegment]:
    """
    Đọc tài liệu → segment theo điều khoản.

    Mỗi segment biết mình nằm trong vùng mở hay khoá; đó là thứ quyết định AI
    được đề xuất sửa (Loại A) hay chỉ được chú thích (Loại B).
    """
    file_row = db.get(ReviewFile, version.file_id) if version.file_id else None
    if file_row is None:
        raise RuntimeError("version hiện tại không có tệp")

    blob = get_storage().get(file_row.storage_key)
    inventory = OoxmlReader().read(DocxPackage.load(blob))
    paragraphs: list[ParagraphDescriptor] = inventory.paragraphs

    writable = {
        f.perm_id
        for f in db.execute(
            select(DocumentField).where(
                DocumentField.version_id == version.id, DocumentField.writable.is_(True)
            )
        ).scalars()
    }

    out: list[MatchSegment] = []
    for item in segment_document(paragraphs):
        # Chỉ coi là "mở" khi vùng đó THẬT SỰ ghi được — vùng rỗng và vùng bắc
        # qua bảng tuy là perm range nhưng writer không ghi được (chế độ C).
        perm_id = next((p for p in item.perm_ids if p in writable), None)
        out.append(
            MatchSegment(
                id=str(item.ordinal),
                text=item.full_text,
                is_open=perm_id is not None,
                perm_id=perm_id,
                numbering_label=item.citation,
            )
        )
    return out


def _persist(
    db: Session,
    review: ContractReview,
    result: pipeline.PipelineResult,
    *,
    merged: checklist.MergedChecklist,
    judge_prompt_version: str,
    model_id: str,
    model_hash: str,
) -> None:
    settings = get_settings()
    scores = result.scores

    run = AiRun(
        review_id=review.id,
        version_no=review.version,
        stage="checklist_review",
        model_id=model_id,
        model_hash=model_hash,
        prompt_stage="checklist_review",
        prompt_version=judge_prompt_version,
        checklist_config_version=merged.config_version_key,
        temperature=0,
        seed=settings.LLM_SEED,
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
        latency_ms=result.usage.latency_ms,
        status="ok" if not result.usage.errors else "partial",
        is_fallback=result.is_fallback,
        error="; ".join(result.usage.errors[:5]) or None,
        score_breakdown=scores.breakdown if scores else {},
    )
    db.add(run)
    db.flush()

    db.query(AiFinding).filter(AiFinding.review_id == review.id).delete()
    db.query(AiProposal).filter(AiProposal.review_id == review.id).delete()

    for group, items in result.groups.items():
        for judgment in items:
            db.add(
                AiFinding(
                    review_id=review.id,
                    run_id=run.id,
                    group_name=group,
                    severity=judgment.severity,
                    clause_code=judgment.clause_code or None,
                    title=judgment.clause_name[:500],
                    description=judgment.rationale,
                    related_field_id=judgment.field_id,
                    source=judgment.source,
                )
            )

    for judgment in result.judgments:
        _add_proposal(db, review, run, judgment)

    _add_locked_annotations(db, review, run)

    if scores is not None:
        review.confidence = scores.ai_confidence
        review.fairness = scores.fairness
    review.ai_summary = result.ai_summary
    review.failure_reason = None
    review.status = ReviewStatus.REVIEWED.value
    db.flush()


def _add_proposal(db: Session, review: ContractReview, run: AiRun, judgment: Judgment) -> None:
    """
    Loại A ghi được, Loại B chỉ chú thích.

    `Judgment.is_type_a` đã kiểm cả ba điều kiện: neo được vào vùng mở, có câu
    chữ đề xuất, và không vượt Red Line. Không có đề xuất và cũng không có vấn
    đề gì thì không tạo bản ghi — đừng làm nhiễu danh sách.
    """
    if judgment.verdict in ("ideal_met", "not_applicable"):
        return

    kind = "A" if judgment.is_type_a else "B"
    db.add(
        AiProposal(
            review_id=review.id,
            run_id=run.id,
            kind=kind,
            field_id=judgment.field_id,
            title=f"[{judgment.clause_code}] {judgment.clause_name}"[:500],
            reason=judgment.rationale,
            original_text=judgment.evidence_quote,
            proposed_text=judgment.proposed_text,
            status="pending" if kind == "A" else "annotation",
            confidence=round(judgment.self_confidence * 100, 2),
        )
    )


def _add_locked_annotations(db: Session, review: ContractReview, run: AiRun) -> None:
    """Vùng hệ thống không ghi được — nêu rõ để người dùng biết phải sửa bằng Word."""
    version = _current_version(db, review)
    unwritable = db.execute(
        select(DocumentField).where(
            DocumentField.version_id == version.id, DocumentField.writable.is_(False)
        )
    ).scalars()

    for field in unwritable:
        reason = (
            "Vùng rỗng, không có định dạng để kế thừa"
            if field.region_kind == "empty"
            else "Vùng bắc qua ranh giới bảng — hệ thống không ghi để tránh vỡ bảng"
        )
        db.add(
            AiProposal(
                review_id=review.id,
                run_id=run.id,
                kind="B",
                field_id=field.perm_id,
                title=f"Không sửa được trên hệ thống: {field.label or field.perm_id}"[:500],
                reason=reason,
                original_text=field.value_text[:2000],
                proposed_text="",
                status="annotation",
                confidence=100,
            )
        )
