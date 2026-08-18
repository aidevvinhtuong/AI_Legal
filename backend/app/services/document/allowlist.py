"""
Allow-list Lớp 1 — hiện thực của ràng buộc C-3 và NFR-S3.

    Không byte nào trong vùng khoá của hợp đồng được thay đổi.
    Kể cả khi LLM bị lừa, frontend bị bypass, hay user cố tình.

Lớp này lọc **trước khi ghi**. Nguồn duy nhất của sự thật là bản kiểm kê
`FieldInventory` đọc ra từ chính file đang ghi — không phải từ request, không
phải từ cấu hình, không phải từ những gì LLM nói.

Lớp 1 chặn *input độc hại*. Nó KHÔNG chặn được *bug của chính chúng ta* — một
lỗi trong writer làm xoá nhầm `w:sectPr` sẽ đi lọt. Việc đó là của `postcheck`
(Lớp 2). Hai lớp phục vụ hai mối đe doạ khác nhau, phải chạy cả hai.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.document.model import FieldDescriptor, RegionKind

# Ký tự XML 1.0 không cho phép — lọt xuống lxml sẽ ném ValueError ở giữa vòng
# ghi, lúc đó cây đã bị sửa dở. Chặn sớm để mọi thay đổi là all-or-nothing.
_ILLEGAL = frozenset(chr(c) for c in range(0x20) if c not in (0x09, 0x0A, 0x0D)) | frozenset("￾￿")


@dataclass(frozen=True)
class FieldChange:
    """
    Một yêu cầu ghi. `value` là `str` cho vùng atomic, `list[str]` cho vùng block
    (mỗi phần tử là một đoạn).
    """

    perm_id: str
    value: str | list[str]

    @property
    def is_block(self) -> bool:
        return isinstance(self.value, list)

    @property
    def paragraphs(self) -> list[str]:
        return list(self.value) if isinstance(self.value, list) else [self.value]

    @property
    def preview(self) -> str:
        joined = "\n".join(self.paragraphs)
        return joined[:120]


@dataclass(frozen=True)
class Rejection:
    """Một yêu cầu ghi bị từ chối. `reason` là mã ổn định để ghi audit và đếm metric."""

    perm_id: str
    reason: str
    detail: str = ""


class AllowList:
    """Bao quanh `FieldInventory`. Chỉ trả lời đúng một câu hỏi: được ghi hay không."""

    def __init__(self, fields: list[FieldDescriptor]) -> None:
        self._all = {f.perm_id: f for f in fields}
        self._writable = {f.perm_id: f for f in fields if f.writable}

    @property
    def writable_perm_ids(self) -> frozenset[str]:
        return frozenset(self._writable)

    def allows(self, perm_id: str) -> bool:
        return perm_id in self._writable

    def filter(self, changes: list[FieldChange]) -> tuple[list[FieldChange], list[Rejection]]:
        """
        Chia yêu cầu thành (được ghi, bị từ chối).

        Không ném exception: tầng trên cần ghi audit cho *từng* yêu cầu bị chặn
        rồi mới quyết định có tiếp tục với phần hợp lệ hay không.
        """
        ok: list[FieldChange] = []
        rejected: list[Rejection] = []
        seen: set[str] = set()

        for change in changes:
            reject = self._check(change, seen)
            if reject is not None:
                rejected.append(reject)
            else:
                seen.add(change.perm_id)
                ok.append(change)

        return ok, rejected

    # ── Kiểm từng yêu cầu ─────────────────────────────────────────────────
    def _check(self, change: FieldChange, seen: set[str]) -> Rejection | None:
        pid = change.perm_id

        if pid in seen:
            return Rejection(pid, "duplicate_change", "cùng một vùng xuất hiện hai lần")

        field = self._all.get(pid)
        if field is None:
            # Trường hợp nguy hiểm nhất: id không có trong tài liệu. Có thể là
            # vùng khoá, có thể là id bịa ra.
            return Rejection(pid, "not_in_allowlist", "vùng không tồn tại trong tài liệu")

        if not field.writable:
            return Rejection(pid, _reason_for(field.region_kind), _detail_for(field.region_kind))

        for text in change.paragraphs:
            bad = _ILLEGAL.intersection(text)
            if bad:
                codes = ", ".join(f"U+{ord(c):04X}" for c in sorted(bad))
                return Rejection(pid, "illegal_characters", f"ký tự không hợp lệ: {codes}")

        if field.region_kind is RegionKind.ATOMIC_FIELD and change.is_block:
            return Rejection(pid, "value_type_mismatch", "vùng atomic chỉ nhận một chuỗi")

        if field.region_kind is RegionKind.BLOCK_REGION:
            if not change.is_block:
                return Rejection(pid, "value_type_mismatch", "vùng block phải nhận danh sách đoạn")
            if len(change.paragraphs) != field.para_count:
                return Rejection(
                    pid,
                    "paragraph_count_mismatch",
                    f"vùng có {field.para_count} đoạn, đề xuất đưa {len(change.paragraphs)}",
                )

        return None


def _reason_for(kind: RegionKind) -> str:
    if kind is RegionKind.EMPTY:
        return "empty_region_unsupported"
    if kind is RegionKind.CROSS_TABLE:
        return "cross_table_write_disabled"
    return "not_in_allowlist"


def _detail_for(kind: RegionKind) -> str:
    if kind is RegionKind.EMPTY:
        return "vùng rỗng, không có định dạng để kế thừa"
    if kind is RegionKind.CROSS_TABLE:
        return "vùng bắc qua ranh giới bảng — van an toàn đang tắt"
    return ""
