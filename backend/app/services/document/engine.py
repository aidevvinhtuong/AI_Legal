"""
`DocumentEngine` — ranh giới duy nhất giữa tầng nghiệp vụ và tầng OOXML.

Mục đích là chống khoá cứng vào một thư viện: đổi engine = viết implementation
mới, không đụng `services/review` hay `services/ai`. Phase 1 có đúng một
implementation, `LxmlDocumentEngine`.

`apply_field_changes` là **luồng ghi hoàn chỉnh** và là nơi duy nhất được phép
sinh ra một tài liệu mới. Nó ép cả hai lớp chặn chạy theo đúng thứ tự:

    lọc allow-list (Lớp 1) → ghi → hậu kiểm (Lớp 2) → mới trả ra bytes

Không có đường nào khác để ghi tài liệu. Ai đó gọi thẳng `writer_inline` là bỏ
qua cả hai lớp — nên writer nằm ở module riêng và không được export ra ngoài
package.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.services.document.allowlist import AllowList, FieldChange, Rejection
from app.services.document.errors import LockViolationError
from app.services.document.model import FieldInventory, RegionKind, WriteReport, XmlDiff
from app.services.document.ooxml import DOCUMENT_PART, DocxPackage
from app.services.document.ooxml_reader import OoxmlReader
from app.services.document.postcheck import assert_no_diff, diff_outside
from app.services.document.writer_block import write_block
from app.services.document.writer_common import find_body
from app.services.document.writer_inline import write_inline


@dataclass(frozen=True)
class WriteResult:
    """Kết quả một lần ghi. `document` là bytes gốc nếu không có gì được ghi."""

    document: bytes
    applied: tuple[WriteReport, ...] = ()
    rejected: tuple[Rejection, ...] = ()

    @property
    def changed(self) -> bool:
        return bool(self.applied)


class DocumentEngine(Protocol):
    """Hợp đồng tối thiểu mà tầng nghiệp vụ được phép trông cậy."""

    def parse(self, blob: bytes) -> DocxPackage: ...

    def get_field_inventory(self, pkg: DocxPackage) -> FieldInventory: ...

    def apply_field_changes(
        self, blob: bytes, changes: list[FieldChange]
    ) -> WriteResult: ...

    def diff_outside(
        self, before: bytes, after: bytes, allowed_perm_ids: set[str]
    ) -> list[XmlDiff]: ...


class LxmlDocumentEngine:
    """Implementation Phase 1: `lxml` + thao tác trực tiếp trên OOXML."""

    def __init__(
        self,
        *,
        atomic_max_chars: int = 200,
        allow_cross_table_write: bool = False,
    ) -> None:
        self._reader = OoxmlReader(
            atomic_max_chars=atomic_max_chars,
            allow_cross_table_write=allow_cross_table_write,
        )

    # ── Đọc ───────────────────────────────────────────────────────────────
    def parse(self, blob: bytes) -> DocxPackage:
        return DocxPackage.load(blob)

    def get_field_inventory(self, pkg: DocxPackage) -> FieldInventory:
        return self._reader.read(pkg)

    # ── Ghi ───────────────────────────────────────────────────────────────
    def apply_field_changes(self, blob: bytes, changes: list[FieldChange]) -> WriteResult:
        """
        Ghi một tập thay đổi. All-or-nothing: hậu kiểm hỏng thì ném, không trả
        ra tài liệu dở dang.
        """
        pkg = self.parse(blob)
        inventory = self.get_field_inventory(pkg)

        ok, rejected = AllowList(inventory.fields).filter(changes)
        if not ok:
            return WriteResult(document=blob, rejected=tuple(rejected))

        body = find_body(pkg.tree(DOCUMENT_PART))
        reports = [self._write_one(body, inventory, change) for change in ok]

        pkg.mark_dirty(DOCUMENT_PART)
        after = pkg.to_bytes()

        # Lớp 2 — không tin writer, kiểm bằng chứng cứ
        assert_no_diff(before=blob, after=after, allowed_perm_ids={c.perm_id for c in ok})

        return WriteResult(document=after, applied=tuple(reports), rejected=tuple(rejected))

    def diff_outside(
        self, before: bytes, after: bytes, allowed_perm_ids: set[str]
    ) -> list[XmlDiff]:
        return diff_outside(before, after, allowed_perm_ids)

    # ── Nội bộ ────────────────────────────────────────────────────────────
    @staticmethod
    def _write_one(body, inventory: FieldInventory, change: FieldChange) -> WriteReport:
        field = inventory.field_by_perm_id(change.perm_id)
        if field is None or not field.writable:
            # Không thể xảy ra nếu AllowList chạy trước — giữ lại như chốt an
            # toàn cuối cùng, phòng khi có đường gọi mới quên lọc.
            raise LockViolationError(change.perm_id)

        if field.region_kind is RegionKind.ATOMIC_FIELD:
            return write_inline(body, change.perm_id, change.paragraphs[0])
        return write_block(body, change.perm_id, change.paragraphs)
