"""
Nghiệp vụ vòng đời ticket.

Router chỉ validate và gọi vào đây; mọi quy tắc nằm ở tầng này để worker và
script dùng lại được y hệt mà không đi qua HTTP.

Điểm cốt lõi: **đường ghi tài liệu duy nhất** là `save_fields()`, và nó luôn đi
qua `LxmlDocumentEngine.apply_field_changes` — tức luôn có allow-list Lớp 1 và
hậu kiểm Lớp 2. Không có hàm nào khác trong hệ thống được ghi `.docx`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.domain.enums import (
    Permission,
    ReviewAction,
    ReviewKind,
    ReviewStatus,
    UserRole,
    VersionAction,
)
from app.domain.errors import ConflictError, NotFoundError, ValidationError, WriteRejectedError
from app.domain.rbac import (
    Principal,
    assert_can_edit_document,
    assert_can_view_review,
    review_scope,
)
from app.domain.state_machine import TransitionContext, allowed_actions, next_status
from app.infra.models import (
    AiFinding,
    AiProposal,
    AiRun,
    AuditLog,
    CatalogItem,
    ChatMessage,
    ContractReview,
    DocumentField,
    DocumentSequence,
    FeedbackItem,
    ReviewFile,
    ReviewVersion,
    User,
)
from app.services.ai.consistency import run_all as run_consistency
from app.services.document.allowlist import FieldChange
from app.services.document.engine import LxmlDocumentEngine
from app.services.document.model import FieldInventory, RegionKind
from app.services.storage.objects import get_storage

MAX_UPLOAD_HINT = "Chỉ nhận tệp .docx"


@dataclass(frozen=True)
class ReviewBundle:
    """Toàn bộ dữ liệu của một ticket — đủ để dựng `ContractReview` cho FE."""

    review: ContractReview
    owner: User | None
    fields: list[DocumentField]
    proposals: list[AiProposal]
    messages: list[ChatMessage]
    findings: list[AiFinding]
    feedback: list[FeedbackItem]
    versions: list[tuple[ReviewVersion, ReviewFile | None]]
    files: dict[str, ReviewFile]


# ─────────────────────────────────────────────────────────────────────────────
# Số tài liệu
# ─────────────────────────────────────────────────────────────────────────────
def next_document_number(db: Session, *, entity_code: str, category_code: str) -> str:
    """
    `(Mã công ty).(Mã loại HĐ).YY + STT4` → `VTS.HQP.260001` (Blueprint v1.12).

    STT tăng theo TỪNG CÔNG TY. Cấp số bằng `SELECT … FOR UPDATE` trên đúng một
    dòng: hai request đồng thời sẽ xếp hàng chứ không thể ra trùng số.
    """
    entity_code = (entity_code or "SGVN").upper()
    category_code = (category_code or "GEN").upper()
    yy = datetime.now(timezone.utc).strftime("%y")

    row = db.execute(
        select(DocumentSequence)
        .where(
            DocumentSequence.business_entity_code == entity_code,
            DocumentSequence.year_yy == yy,
        )
        .with_for_update()
    ).scalar_one_or_none()

    if row is None:
        row = DocumentSequence(business_entity_code=entity_code, year_yy=yy, last_value=0)
        db.add(row)
        db.flush()

    row.last_value += 1
    return f"{entity_code}.{category_code}.{yy}{row.last_value:04d}"


# ─────────────────────────────────────────────────────────────────────────────
# Truy vấn
# ─────────────────────────────────────────────────────────────────────────────
def list_reviews(db: Session, principal: Principal) -> list[tuple[ContractReview, User | None]]:
    """
    Phạm vi enforce ở ĐÂY, trong câu truy vấn — không phải ở router (bất biến B4).

    Router quên kiểm quyền thì truy vấn này vẫn không trả về dữ liệu ngoài phạm vi.
    """
    scope = review_scope(principal)
    owner = User.__table__.alias("owner")
    stmt = (
        select(ContractReview, User)
        .join(User, User.id == ContractReview.owner_id)
        .order_by(ContractReview.created_at.desc())
    )

    if not scope.all_reviews:
        conditions = []
        if scope.owner_id is not None:
            conditions.append(ContractReview.owner_id == scope.owner_id)
        if scope.subordinate_of is not None:
            conditions.append(User.line_manager_id == scope.subordinate_of)
        stmt = stmt.where(or_(*conditions)) if conditions else stmt.where(False)

    del owner
    return [(r, u) for r, u in db.execute(stmt).all()]


def get_review(db: Session, review_id: uuid.UUID, principal: Principal) -> ContractReview:
    review = db.get(ContractReview, review_id)
    if review is None:
        raise NotFoundError("Hợp đồng")

    owner = db.get(User, review.owner_id)
    assert_can_view_review(
        principal,
        owner_id=review.owner_id,
        owner_line_manager_id=owner.line_manager_id if owner else None,
    )
    return review


def load_bundle(db: Session, review: ContractReview) -> ReviewBundle:
    owner = db.get(User, review.owner_id)

    current_version = db.execute(
        select(ReviewVersion)
        .where(ReviewVersion.review_id == review.id)
        .order_by(ReviewVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none()

    fields: list[DocumentField] = []
    if current_version is not None:
        fields = list(
            db.execute(
                select(DocumentField)
                .where(DocumentField.version_id == current_version.id)
                .order_by(DocumentField.ordinal)
            ).scalars()
        )

    versions_rows = list(
        db.execute(
            select(ReviewVersion)
            .where(ReviewVersion.review_id == review.id)
            .order_by(ReviewVersion.version)
        ).scalars()
    )
    file_by_id = {
        f.id: f
        for f in db.execute(
            select(ReviewFile).where(ReviewFile.review_id == review.id)
        ).scalars()
    }
    versions = [(v, file_by_id.get(v.file_id) if v.file_id else None) for v in versions_rows]

    files: dict[str, ReviewFile] = {}
    for file in file_by_id.values():
        # Bản mới nhất của mỗi loại thắng
        current = files.get(file.kind)
        if current is None or file.created_at >= current.created_at:
            files[file.kind] = file

    return ReviewBundle(
        review=review,
        owner=owner,
        fields=fields,
        proposals=list(
            db.execute(
                select(AiProposal)
                .where(AiProposal.review_id == review.id)
                .order_by(AiProposal.created_at)
            ).scalars()
        ),
        messages=list(
            db.execute(
                select(ChatMessage)
                .where(ChatMessage.review_id == review.id)
                .order_by(ChatMessage.created_at)
            ).scalars()
        ),
        findings=list(
            db.execute(
                select(AiFinding)
                .where(AiFinding.review_id == review.id)
                .order_by(AiFinding.created_at)
            ).scalars()
        ),
        feedback=list(
            db.execute(
                select(FeedbackItem)
                .where(FeedbackItem.review_id == review.id)
                .order_by(FeedbackItem.created_at)
            ).scalars()
        ),
        versions=versions,
        files=files,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Tạo ticket
# ─────────────────────────────────────────────────────────────────────────────
def create_review(
    db: Session,
    principal: Principal,
    *,
    title: str,
    contract_type_id: str,
    contract_type_label: str,
    intake: dict[str, Any],
    file_name: str,
    blob: bytes,
    kind: ReviewKind = ReviewKind.FULL,
    prompt: str = "",
) -> ContractReview:
    """
    Tạo ticket + version 1 + kiểm kê vùng mở.

    Thứ tự cố ý: **ghi object TRƯỚC, commit DB SAU**. Hỏng giữa chừng chỉ để lại
    object mồ côi (vô hại), thay vì bản ghi trỏ vào file không tồn tại.
    """
    principal.require(Permission.CONTRACTS_CREATE)

    if not file_name.lower().endswith(".docx"):
        raise ValidationError(MAX_UPLOAD_HINT, code="invalid_file_type")

    engine = LxmlDocumentEngine()
    try:
        inventory = engine.get_field_inventory(engine.parse(blob))
    except Exception as e:  # DocxError và mọi lỗi định dạng khác
        raise ValidationError(f"Không đọc được tệp .docx: {e}", code="invalid_docx") from e

    # FE gửi `businessEntityId` là slug (`be_sgvn`), không phải mã hiển thị.
    # Tra mã thật từ danh mục, nếu không sẽ ra số tài liệu kiểu `BE_SGVN.HQP...`
    entity = _catalog_code(db, "businessEntities", intake, "businessEntity", "SGVN")
    category = _catalog_code(db, "documentCategories", intake, "documentCategory", "GEN")
    code = next_document_number(db, entity_code=entity, category_code=category)

    stored = get_storage().put(
        blob,
        prefix=f"reviews/{code}",
        file_name=file_name,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )

    intake = dict(intake)
    intake.setdefault("documentNumber", code)

    review = ContractReview(
        code=code,
        document_id=code.rsplit(".", 1)[-1],
        title=title or intake.get("documentName") or code,
        kind=kind.value,
        status=ReviewStatus.QUEUED.value,
        owner_id=principal.user_id,
        contract_type_id=contract_type_id,
        contract_type_label=contract_type_label,
        intake=intake,
        prompt=prompt,
        version=1,
    )
    db.add(review)
    db.flush()

    file_row = ReviewFile(
        review_id=review.id,
        kind="original",
        file_name=file_name,
        storage_key=stored.key,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        uploaded_by=principal.user_id,
    )
    db.add(file_row)
    db.flush()

    _push_version(
        db,
        review=review,
        action=VersionAction.CREATE,
        principal=principal,
        file=file_row,
        label="Tạo tài liệu",
        inventory=inventory,
    )

    _audit(
        db,
        principal,
        action="review_created",
        entity_type="contract_review",
        entity_id=str(review.id),
        new_value={"code": code, "fileName": file_name, "openRegions": len(inventory.fields)},
    )
    return review


def _catalog_code(
    db: Session,
    kind: str,
    intake: dict[str, Any],
    prefix: str,
    fallback: str,
) -> str:
    """
    Mã hiển thị của một mục danh mục, ưu tiên theo thứ tự:
    `<prefix>Code` do FE gửi → `code` tra từ DB theo slug → slug → mặc định.
    """
    explicit = intake.get(f"{prefix}Code")
    if explicit:
        return str(explicit).upper()

    slug = intake.get(f"{prefix}Id")
    if slug:
        item = db.execute(
            select(CatalogItem).where(CatalogItem.kind == kind, CatalogItem.slug == str(slug))
        ).scalar_one_or_none()
        if item is not None and item.code:
            return item.code.upper()
        return str(slug).upper()

    return fallback


def _push_version(
    db: Session,
    *,
    review: ContractReview,
    action: VersionAction,
    principal: Principal | None,
    file: ReviewFile | None,
    label: str,
    inventory: FieldInventory | None,
    field_diff: list[dict[str, Any]] | None = None,
) -> ReviewVersion:
    """Tạo snapshot bất biến + dựng lại allow-list từ chính file của version đó."""
    version = ReviewVersion(
        review_id=review.id,
        version=review.version,
        action=action.value,
        label=label,
        actor_id=principal.user_id if principal else None,
        actor_name=principal.username if principal else "system",
        actor_role=principal.role.value if principal else "system",
        file_id=file.id if file else None,
        file_sha256=file.sha256 if file else "",
        field_diff=field_diff or [],
    )
    db.add(version)
    db.flush()

    if inventory is not None:
        _index_fields(db, review=review, version=version, inventory=inventory)
    return version


def _index_fields(
    db: Session,
    *,
    review: ContractReview,
    version: ReviewVersion,
    inventory: FieldInventory,
    labels: dict[str, str] | None = None,
) -> None:
    labels = labels or {}
    for field in inventory.fields:
        db.add(
            DocumentField(
                review_id=review.id,
                version_id=version.id,
                perm_id=field.perm_id,
                ordinal=field.ordinal,
                region_kind=field.region_kind.value,
                writable=field.writable,
                label=labels.get(field.perm_id, ""),
                field_type="text",
                value_text=field.inner_text,
                char_len=field.char_len,
                para_count=field.para_count,
                para_ids=list(field.para_ids),
                in_table=field.in_table,
            )
        )
    db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Ghi trường — ĐƯỜNG GHI DUY NHẤT
# ─────────────────────────────────────────────────────────────────────────────
def save_fields(
    db: Session,
    principal: Principal,
    review: ContractReview,
    changes: list[FieldChange],
) -> ReviewBundle:
    """
    Ghi một tập trường mở rồi tạo version mới.

    `apply_field_changes` đã ép cả hai lớp chặn chạy. Ở đây chỉ còn ba việc:
    kiểm quyền, ghi audit `cũ → mới` (quyết định D7), và bump version.
    """
    assert_can_edit_document(
        principal, owner_id=review.owner_id, status=ReviewStatus(review.status)
    )
    if not changes:
        raise ValidationError("Không có thay đổi nào để lưu")

    current_version = _current_version(db, review)
    file_row = db.get(ReviewFile, current_version.file_id) if current_version.file_id else None
    if file_row is None:
        raise ConflictError("Version hiện tại không có tệp đính kèm", code="missing_file")

    before = get_storage().get(file_row.storage_key)
    old_values = {
        f.perm_id: f.value_text
        for f in db.execute(
            select(DocumentField).where(DocumentField.version_id == current_version.id)
        ).scalars()
    }

    engine = LxmlDocumentEngine()
    result = engine.apply_field_changes(before, changes)

    if result.rejected and not result.applied:
        for rejection in result.rejected:
            _audit(
                db,
                principal,
                action="writeback_rejected",
                entity_type="document_field",
                entity_id=rejection.perm_id,
                new_value={"reason": rejection.reason, "detail": rejection.detail},
            )
        raise WriteRejectedError(
            [
                {"permId": r.perm_id, "reason": r.reason, "detail": r.detail}
                for r in result.rejected
            ]
        )

    stored = get_storage().put(
        result.document,
        prefix=f"reviews/{review.code}",
        file_name=file_row.file_name,
        content_type=file_row.content_type,
    )
    new_file = ReviewFile(
        review_id=review.id,
        kind="reviewed",
        file_name=file_row.file_name,
        storage_key=stored.key,
        content_type=stored.content_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        uploaded_by=principal.user_id,
    )
    db.add(new_file)
    db.flush()

    diff = [
        {
            "permId": report.perm_id,
            "old": old_values.get(report.perm_id, report.old_text),
            "new": report.new_text,
            "mode": report.mode,
        }
        for report in result.applied
    ]

    review.version += 1
    inventory = engine.get_field_inventory(engine.parse(result.document))
    _push_version(
        db,
        review=review,
        action=VersionAction.FIELD_EDIT,
        principal=principal,
        file=new_file,
        label=f"Sửa {len(result.applied)} trường",
        inventory=inventory,
        field_diff=diff,
    )

    for entry in diff:
        _audit(
            db,
            principal,
            action="field_updated",
            entity_type="document_field",
            entity_id=entry["permId"],
            old_value={"value": entry["old"]},
            new_value={"value": entry["new"]},
        )

    db.flush()
    return load_bundle(db, review)


def _current_version(db: Session, review: ContractReview) -> ReviewVersion:
    version = db.execute(
        select(ReviewVersion)
        .where(ReviewVersion.review_id == review.id)
        .order_by(ReviewVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    if version is None:
        raise ConflictError("Ticket chưa có version nào", code="no_version")
    return version


# ─────────────────────────────────────────────────────────────────────────────
# Chuyển trạng thái
# ─────────────────────────────────────────────────────────────────────────────
def build_context(
    db: Session, review: ContractReview, principal: Principal | None
) -> TransitionContext:
    owner = db.get(User, review.owner_id)
    return TransitionContext(
        status=ReviewStatus(review.status),
        kind=ReviewKind(review.kind),
        role=principal.role if principal else None,
        is_owner=bool(principal and principal.user_id == review.owner_id),
        is_line_manager_of_owner=bool(
            principal and owner and owner.line_manager_id == principal.user_id
        ),
        owner_has_line_manager=bool(owner and owner.line_manager_id),
        has_unsaved_changes=False,  # lưu thủ công: đã lưu mới có trong DB (A4c)
        ai_job_running=review.status in (ReviewStatus.QUEUED.value, ReviewStatus.PROCESSING.value),
        markers_valid=False,  # vòng eContract (G6)
        signing_matrix_ready=False,  # vòng eContract (G6)
        comment_provided=False,
    )


def apply_action(
    db: Session,
    principal: Principal | None,
    review: ContractReview,
    action: ReviewAction,
    *,
    context_overrides: dict[str, Any] | None = None,
) -> ContractReview:
    ctx = build_context(db, review, principal)
    if context_overrides:
        ctx = TransitionContext(**{**ctx.__dict__, **context_overrides})

    old_status = review.status
    review.status = next_status(ctx, action).value

    _audit(
        db,
        principal,
        action=f"status_{action.value}",
        entity_type="contract_review",
        entity_id=str(review.id),
        old_value={"status": old_status},
        new_value={"status": review.status},
    )
    db.flush()
    return review


def available_actions(
    db: Session, review: ContractReview, principal: Principal
) -> list[str]:
    return [a.value for a in allowed_actions(build_context(db, review, principal))]


# ─────────────────────────────────────────────────────────────────────────────
# AI — bản rule-based, chưa gọi LLM
# ─────────────────────────────────────────────────────────────────────────────
def run_rule_based_review(db: Session, review: ContractReview) -> ContractReview:
    """
    Chạy Stage 0.5 (consistency rules) và dựng findings + hai điểm số.

    **Đây CHƯA phải AI thật.** Nó là tầng deterministic của pipeline (G4 sẽ nối
    LLM vào bên cạnh, không thay thế). Đánh dấu `is_fallback=True` để UI hiện
    banner đúng như khi LLM chết — không được để người dùng tưởng đã có phán xét
    của mô hình.
    """
    version = _current_version(db, review)
    fields = list(
        db.execute(
            select(DocumentField).where(DocumentField.version_id == version.id)
        ).scalars()
    )

    run = AiRun(
        review_id=review.id,
        version_no=review.version,
        stage="consistency_rules",
        model_id="rule-based",
        status="ok",
        is_fallback=True,
    )
    db.add(run)
    db.flush()

    db.query(AiFinding).filter(AiFinding.review_id == review.id).delete()
    db.query(AiProposal).filter(AiProposal.review_id == review.id).delete()

    writable = [f for f in fields if f.writable]
    issues = run_consistency(
        [(f.perm_id, f.label or f"Vùng mở #{f.ordinal}", f.value_text) for f in writable]
    )

    for issue in issues:
        db.add(
            AiFinding(
                review_id=review.id,
                run_id=run.id,
                group_name=issue.group,
                severity=issue.severity,
                title=issue.title,
                description=issue.description,
                related_field_id=issue.field_id,
                source="rule",
            )
        )

    # Vùng không ghi được → Loại B, chỉ chú thích (chế độ C của TS-04)
    for field in fields:
        if field.writable:
            continue
        reason = (
            "Vùng rỗng, không có định dạng để kế thừa"
            if field.region_kind == RegionKind.EMPTY.value
            else "Vùng bắc qua ranh giới bảng — hệ thống không ghi để tránh vỡ bảng"
        )
        db.add(
            AiProposal(
                review_id=review.id,
                run_id=run.id,
                kind="B",
                field_id=field.perm_id,
                title=f"Không sửa được trên hệ thống: {field.label or field.perm_id}",
                reason=reason,
                original_text=field.value_text[:2000],
                proposed_text="",
                status="annotation",
                confidence=100,
            )
        )

    scores = compute_scores(fields=fields, issues=issues)
    review.confidence = scores["aiConfidenceScore"]
    review.fairness = scores["fairnessScore"]
    review.ai_summary = scores["summary"]
    run.score_breakdown = scores
    review.status = ReviewStatus.REVIEWED.value
    db.flush()
    return review


def compute_scores(*, fields: list[DocumentField], issues: list[Any]) -> dict[str, Any]:
    """
    Hai điểm số do CODE tính, deterministic, giải thích được (bất biến B2).

    LLM không bao giờ được sinh ra con số — nó chỉ viết phần diễn giải.
    Công thức này là bản rule-only; G4 bổ sung thành phần từ LLM vào cùng khung.
    """
    total = len(fields)
    writable = sum(1 for f in fields if f.writable)
    empty = sum(1 for f in fields if f.writable and not f.value_text.strip())

    blocks = sum(1 for i in issues if i.severity == "block")
    highs = sum(1 for i in issues if i.severity == "high")

    coverage = (writable / total) if total else 0.0
    filled = ((writable - empty) / writable) if writable else 0.0

    # Độ chắc chắn của phân tích: phủ được bao nhiêu vùng, dữ liệu đủ chưa.
    # Chưa có LLM nên trần là 70 — nói thẳng ra bằng con số thay vì giả vờ chắc chắn.
    confidence = round(min(70.0, 100 * (0.5 * coverage + 0.5 * filled)), 1)

    # Cân bằng điều khoản: mỗi lỗi chặn trừ 25, mỗi cảnh báo cao trừ 8.
    fairness = round(max(0.0, min(100.0, 100 - 25 * blocks - 8 * highs)), 1)

    summary = (
        f"Đã kiểm {total} vùng mở ({writable} vùng sửa được). "
        f"Phát hiện {blocks} lỗi nghiêm trọng và {highs} cảnh báo bằng bộ quy tắc "
        f"kiểm tra nhất quán. Chưa chạy phán xét của mô hình ngôn ngữ — "
        f"kết quả mang tính sơ bộ."
    )

    return {
        "aiConfidenceScore": confidence,
        "fairnessScore": fairness,
        "summary": summary,
        "calibrated": False,
        "inputs": {
            "totalRegions": total,
            "writableRegions": writable,
            "emptyRegions": empty,
            "coverage": round(coverage, 3),
            "filledRatio": round(filled, 3),
            "blockIssues": blocks,
            "highIssues": highs,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Audit
# ─────────────────────────────────────────────────────────────────────────────
def _audit(
    db: Session,
    principal: Principal | None,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=principal.user_id if principal else None,
            actor_name=principal.username if principal else "system",
            actor_role=principal.role.value if principal else "system",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            old_value=old_value,
            new_value=new_value,
        )
    )


def count_by_status(db: Session, principal: Principal) -> dict[str, int]:
    rows = list_reviews(db, principal)
    out: dict[str, int] = {}
    for review, _ in rows:
        out[review.status] = out.get(review.status, 0) + 1
    return out


def queue_position(db: Session, review: ContractReview) -> int | None:
    """FIFO, không ưu tiên (ràng buộc C-7)."""
    if review.status != ReviewStatus.QUEUED.value:
        return None
    ahead = db.execute(
        select(func.count())
        .select_from(ContractReview)
        .where(
            ContractReview.status == ReviewStatus.QUEUED.value,
            ContractReview.created_at < review.created_at,
        )
    ).scalar_one()
    return int(ahead) + 1


__all__ = [
    "ReviewBundle",
    "UserRole",
    "apply_action",
    "available_actions",
    "compute_scores",
    "count_by_status",
    "create_review",
    "get_review",
    "list_reviews",
    "load_bundle",
    "next_document_number",
    "queue_position",
    "run_rule_based_review",
    "save_fields",
]
