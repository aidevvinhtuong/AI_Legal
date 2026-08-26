"""
Structural binding — vá lỗ hổng của Blueprint (CLAUDE.md mục 5.1).

Blueprint bỏ việc **so khớp nội dung** file upload với template. Đúng: vùng mở
thay đổi hợp lệ nên so nội dung sẽ báo sai liên tục.

Nhưng nếu chỉ bỏ mà không thêm gì, kịch bản này thành hiện thực:

    Purchasing tải template về → gỡ Restrict Editing bằng Word → sửa điều khoản
    "Luật áp dụng" → upload lên. Hệ thống thấy 0 permStart ⇒ coi TOÀN BỘ tài
    liệu là vùng mở ⇒ AI được phép ghi đè điều khoản pháp lý.

Nên thứ thay thế là **ràng buộc cấu trúc**: cơ chế khoá, tập `permId`, phân loại
vùng, và hash nội dung vùng khoá phải khớp bản template đã đăng ký. Không khớp
thì chặn, không có override (nhất quán C-4).

Hình dạng `FieldStructureIssue` giữ đúng như `reupload-validation.ts` của FE để
component hiển thị lỗi dùng lại được.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from app.services.document.model import (
    FieldInventory,
    Mechanism,
    RegionKind,
    normalize,
    sha256_text,
)

PREVIEW_CHARS = 90
DEFAULT_MAX_LOCKED_DIFFS = 5


@dataclass(frozen=True)
class TemplateRegion:
    """Một vùng mở như nó tồn tại trong template gốc."""

    perm_id: str
    ordinal: int
    region_kind: RegionKind
    para_count: int
    label: str | None = None

    @property
    def display(self) -> str:
        return self.label or f"vùng mở #{self.ordinal}"


@dataclass(frozen=True)
class LockedParagraphRef:
    """Vân tay một đoạn khoá. Giữ `preview` để thông báo lỗi nói được trước/sau."""

    para_id: str
    ordinal: int
    label: str | None
    text_sha256: str
    preview: str


@dataclass(frozen=True)
class TemplateBinding:
    """
    Ảnh chụp cấu trúc của một version template. Sinh lúc Legal đăng ký template,
    lưu vào DB, không bao giờ sửa — đổi template là tạo version mới.
    """

    mechanism: Mechanism
    protection_effective: bool
    regions: tuple[TemplateRegion, ...]
    locked_fingerprint: str
    structure_fingerprint: str
    locked_paragraphs: tuple[LockedParagraphRef, ...] = ()

    @property
    def perm_ids(self) -> frozenset[str]:
        return frozenset(r.perm_id for r in self.regions)

    @property
    def open_region_count(self) -> int:
        return len(self.regions)

    def region_of(self, perm_id: str) -> TemplateRegion | None:
        return next((r for r in self.regions if r.perm_id == perm_id), None)

    def label_of(self, perm_id: str) -> str:
        region = self.region_of(perm_id)
        return region.display if region else f"vùng {perm_id}"


@dataclass(frozen=True)
class FieldStructureIssue:
    """Một điểm không khớp. `type` là mã ổn định; FE ánh xạ sang thông báo."""

    type: str
    location: str
    field_id: str | None = None
    diff_preview: str | None = None

    def as_payload(self) -> dict[str, str | None]:
        """
        Hình dạng gửi ra API — **camelCase**, khớp `FieldStructureIssue` của FE.

        Không dùng `dataclasses.asdict()`: nó giữ nguyên tên thuộc tính Python nên
        FE nhận `diff_preview` trong khi component đọc `diffPreview`, và hiện ra
        một danh sách lỗi **trống chỗ quan trọng nhất** — người dùng thấy "sai
        cấu trúc" mà không biết sai ở đâu. Đã từng như vậy trên cả đường tạo
        ticket lẫn đường đăng ký template.
        """
        return {
            "type": self.type,
            "location": self.location,
            "fieldId": self.field_id,
            "diffPreview": self.diff_preview,
        }


def build_binding(
    inventory: FieldInventory,
    labels: Mapping[str, str] | None = None,
) -> TemplateBinding:
    """
    Dựng binding từ bản kiểm kê của template gốc.

    `labels` là ánh xạ `permId → tên nghiệp vụ` do Legal khai lúc đăng ký
    (`template_field_map`). Không có cũng chạy được, chỉ là thông báo lỗi kém cụ
    thể hơn — vì bản thân `permId` của Range Permission là số ngẫu nhiên vô nghĩa.
    """
    labels = labels or {}
    protection = inventory.protection

    regions = tuple(
        TemplateRegion(
            perm_id=f.perm_id,
            ordinal=f.ordinal,
            region_kind=f.region_kind,
            para_count=f.para_count,
            label=labels.get(f.perm_id),
        )
        for f in sorted(inventory.fields, key=lambda x: x.ordinal)
    )

    locked = tuple(
        LockedParagraphRef(
            para_id=p.para_id,
            ordinal=p.ordinal,
            label=p.numbering_label,
            text_sha256=sha256_text(p.text),
            preview=normalize(p.text)[:PREVIEW_CHARS],
        )
        for p in inventory.locked_paragraphs
        if normalize(p.text)
    )

    return TemplateBinding(
        mechanism=inventory.mechanism,
        protection_effective=bool(protection and protection.is_effective),
        regions=regions,
        locked_fingerprint=inventory.locked_fingerprint(),
        structure_fingerprint=inventory.structure_fingerprint(),
        locked_paragraphs=locked,
    )


def verify(
    inventory: FieldInventory,
    binding: TemplateBinding,
    *,
    max_locked_diffs: int = DEFAULT_MAX_LOCKED_DIFFS,
) -> list[FieldStructureIssue]:
    """
    Đối chiếu file người dùng tải lên với template đã đăng ký.

    Danh sách rỗng = hợp lệ. Khác rỗng = chặn, kèm nói rõ sai ở đâu để Purchasing
    tự sửa được.
    """
    issues: list[FieldStructureIssue] = []

    # ── L1. Cơ chế khoá ───────────────────────────────────────────────────
    # Bắt trọn kịch bản "gỡ Restrict Editing": mọi permStart biến mất.
    if inventory.mechanism is not binding.mechanism:
        got = (
            "không có vùng mở nào"
            if inventory.mechanism is Mechanism.NONE
            else inventory.mechanism.value
        )
        issues.append(
            FieldStructureIssue(
                type="mechanism_mismatch",
                location=f"File dùng {got}, template dùng {binding.mechanism.value}",
                diff_preview=(
                    "Nhiều khả năng Restrict Editing đã bị gỡ. "
                    "Hãy tải lại template gốc từ hệ thống."
                ),
            )
        )
        return issues  # sai ở mức này thì so tiếp là vô nghĩa

    # ── L2. Bảo vệ tài liệu còn hiệu lực ──────────────────────────────────
    # Kẻ tinh vi có thể giữ nguyên perm range mà chỉ tắt enforcement — lúc đó
    # Word không chặn gì nữa dù cấu trúc trông vẫn đúng.
    protection = inventory.protection
    effective = bool(protection and protection.is_effective)
    if binding.protection_effective and not effective:
        issues.append(
            FieldStructureIssue(
                type="protection_removed",
                location="Thiết lập bảo vệ tài liệu (Restrict Editing)",
                diff_preview=(
                    "Template gốc bật chế độ chỉ đọc có hiệu lực, file tải lên thì không."
                ),
            )
        )

    # ── L3. Số lượng và tập permId ────────────────────────────────────────
    got_ids = set(inventory.perm_ids)
    want_ids = set(binding.perm_ids)

    if len(got_ids) != binding.open_region_count:
        issues.append(
            FieldStructureIssue(
                type="count_mismatch",
                location=(f"Có {len(got_ids)} vùng mở, template có {binding.open_region_count}"),
            )
        )

    for missing in sorted(want_ids - got_ids):
        issues.append(
            FieldStructureIssue(
                type="missing_field",
                field_id=missing,
                location=binding.label_of(missing),
            )
        )

    for extra in sorted(got_ids - want_ids):
        issues.append(
            FieldStructureIssue(
                type="unexpected_new_field",
                field_id=extra,
                location="Vùng mở lạ, không có trong template",
            )
        )

    # ── L4. Hình dạng vùng không được đổi ─────────────────────────────────
    # Vùng block bị rút thành atomic nghĩa là nội dung đã bị xoá gần hết.
    for perm_id in sorted(got_ids & want_ids):
        got_field = inventory.field_by_perm_id(perm_id)
        want_region = binding.region_of(perm_id)
        if got_field is None or want_region is None:
            continue
        if got_field.region_kind is not want_region.region_kind:
            issues.append(
                FieldStructureIssue(
                    type="region_kind_changed",
                    field_id=perm_id,
                    location=binding.label_of(perm_id),
                    diff_preview=(
                        f"{want_region.region_kind.value} → {got_field.region_kind.value}"
                    ),
                )
            )

    # ── L5. Nội dung vùng khoá ────────────────────────────────────────────
    if inventory.locked_fingerprint() != binding.locked_fingerprint:
        issues.extend(_locked_diffs(inventory, binding, max_locked_diffs))

    return issues


def _locked_diffs(
    inventory: FieldInventory,
    binding: TemplateBinding,
    limit: int,
) -> list[FieldStructureIssue]:
    """Chỉ ra đúng đoạn khoá nào bị đụng, kèm trích đoạn trước/sau."""
    want = {p.para_id: p for p in binding.locked_paragraphs}
    got = {p.para_id: p for p in inventory.locked_paragraphs if normalize(p.text)}

    out: list[FieldStructureIssue] = []

    for para_id, ref in want.items():
        if len(out) >= limit:
            break
        actual = got.get(para_id)
        if actual is None:
            out.append(
                FieldStructureIssue(
                    type="locked_region_modified",
                    field_id=para_id,
                    location=ref.label or f"Đoạn {ref.ordinal}",
                    diff_preview=f"Đoạn khoá bị xoá — trước: “{ref.preview}”",
                )
            )
        elif sha256_text(actual.text) != ref.text_sha256:
            out.append(
                FieldStructureIssue(
                    type="locked_region_modified",
                    field_id=para_id,
                    location=ref.label or actual.numbering_label or f"Đoạn {ref.ordinal}",
                    diff_preview=(
                        f"Trước: “{ref.preview}” → Sau: “{normalize(actual.text)[:PREVIEW_CHARS]}”"
                    ),
                )
            )

    for para_id, actual in got.items():
        if len(out) >= limit:
            break
        if para_id not in want:
            out.append(
                FieldStructureIssue(
                    type="locked_region_modified",
                    field_id=para_id,
                    location=actual.numbering_label or f"Đoạn {actual.ordinal}",
                    diff_preview=(
                        f"Đoạn khoá lạ được thêm: “{normalize(actual.text)[:PREVIEW_CHARS]}”"
                    ),
                )
            )

    return out


@dataclass(frozen=True)
class BindingResult:
    """Kết quả kiểm cho tầng API — tách `ok` ra để router khỏi tự suy luận."""

    issues: tuple[FieldStructureIssue, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return not self.issues
