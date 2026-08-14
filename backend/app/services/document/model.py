"""
Kiểu dữ liệu của tầng tài liệu.

Đây là ranh giới giữa `services/document` và phần còn lại của hệ thống: mọi thứ
đi ra khỏi module này đều là dataclass thuần, không dính lxml, không dính DB.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum


class Mechanism(str, Enum):
    """Cơ chế đánh dấu vùng mở. Cả 4 template thật đều dùng PERMISSION_RANGE."""

    PERMISSION_RANGE = "permission_range"
    CONTENT_CONTROL = "content_control"
    LEGACY_FORM_FIELD = "legacy_form_field"
    NONE = "none"


class RegionKind(str, Enum):
    """
    Hình dạng vùng mở — quyết định writer nào được dùng (TS-04 mục IV).

    ATOMIC_FIELD  gọn trong 1 đoạn, ngắn        → ghi inline, an toàn nhất
    BLOCK_REGION  trải nhiều đoạn                → ghi theo đoạn, giữ nguyên số đoạn
    CROSS_TABLE   bắc qua ranh giới bảng         → mặc định KHÔNG ghi
    EMPTY         không có run nào bên trong     → KHÔNG ghi được: không có w:rPr
                                                   để kế thừa định dạng
    """

    ATOMIC_FIELD = "atomic_field"
    BLOCK_REGION = "block_region"
    CROSS_TABLE = "cross_table"
    EMPTY = "empty"


def normalize(text: str) -> str:
    """
    Chuẩn hoá để so sánh và băm.

    - NFC: tiếng Việt có thể mã hoá tổ hợp (e + dấu) hoặc dựng sẵn. Không chuẩn
      hoá thì hai chuỗi trông y hệt lại khác hash.
    - Gộp mọi chuỗi khoảng trắng thành một dấu cách.
    - KHÔNG hạ chữ thường: chữ hoa trong hợp đồng có ý nghĩa pháp lý
      ("Bên Bán" là thuật ngữ đã định nghĩa, khác "bên bán").
    """
    text = unicodedata.normalize("NFC", text)
    text = text.replace("​", "").replace("﻿", "")  # zero-width
    return re.sub(r"\s+", " ", text).strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ParagraphDescriptor:
    """Một đoạn văn. `para_id` là anchor bền cho comment và marker (TS-04 mục VII)."""

    para_id: str  # w14:paraId — 100% phủ trên cả 4 template thật
    ordinal: int
    text: str
    style_name: str | None = None
    numbering_label: str | None = None  # 'Điều 5.' — Word sinh, KHÔNG có trong text
    in_table: bool = False
    table_depth: int = 0
    is_open: bool = False
    perm_ids: tuple[str, ...] = ()  # một đoạn có thể chứa NHIỀU vùng mở

    @property
    def text_sha256(self) -> str:
        return sha256_text(self.text)

    @property
    def normalized(self) -> str:
        return normalize(self.text)


@dataclass(frozen=True)
class FieldDescriptor:
    """
    Một vùng mở. Tập các FieldDescriptor có `writable=True` CHÍNH LÀ allow-list
    Lớp 1 mà ràng buộc C-3 nói tới.
    """

    perm_id: str
    mechanism: Mechanism
    region_kind: RegionKind
    writable: bool
    ordinal: int
    inner_text: str  # text BÊN TRONG cặp permStart/permEnd
    para_ids: tuple[str, ...] = ()
    start_para_id: str | None = None
    end_para_id: str | None = None
    in_table: bool = False
    label: str | None = None
    sdt_tag: str | None = None

    @property
    def para_count(self) -> int:
        return len(self.para_ids)

    @property
    def char_len(self) -> int:
        return len(self.inner_text)

    @property
    def value_sha256(self) -> str:
        return sha256_text(self.inner_text)


@dataclass(frozen=True)
class DocumentProtection:
    edit: str | None
    enforcement: bool
    has_password: bool

    @property
    def is_effective(self) -> bool:
        """
        Khai báo `readOnly` mà `enforcement=0` thì Word KHÔNG chặn gì cả.
        Template HDVT-OceanFreight đúng vào trường hợp này.
        """
        return self.enforcement and self.edit == "readOnly"


@dataclass
class FieldInventory:
    """Kết quả đọc một tài liệu — đầu vào cho allow-list, structural binding và AI."""

    mechanism: Mechanism
    fields: list[FieldDescriptor] = field(default_factory=list)
    paragraphs: list[ParagraphDescriptor] = field(default_factory=list)
    protection: DocumentProtection | None = None
    sdt_count: int = 0
    legacy_form_field_count: int = 0
    comment_count: int = 0
    has_tracked_changes: bool = False

    # ── Tra cứu ───────────────────────────────────────────────────────────
    def field_by_perm_id(self, perm_id: str) -> FieldDescriptor | None:
        return next((f for f in self.fields if f.perm_id == perm_id), None)

    def paragraph_by_id(self, para_id: str) -> ParagraphDescriptor | None:
        return next((p for p in self.paragraphs if p.para_id == para_id), None)

    @property
    def writable_perm_ids(self) -> frozenset[str]:
        """Allow-list Lớp 1."""
        return frozenset(f.perm_id for f in self.fields if f.writable)

    @property
    def perm_ids(self) -> tuple[str, ...]:
        return tuple(f.perm_id for f in self.fields)

    @property
    def locked_paragraphs(self) -> list[ParagraphDescriptor]:
        return [p for p in self.paragraphs if not p.is_open]

    def locked_fingerprint(self) -> str:
        """
        Băm nội dung vùng khoá — dùng cho structural binding (TS-04 mục VI).
        Đổi một ký tự trong vùng khoá là hash đổi.
        """
        joined = "\n".join(p.normalized for p in self.locked_paragraphs if p.normalized)
        return hashlib.sha256(joined.encode("utf-8")).hexdigest()

    def structure_fingerprint(self) -> str:
        """Băm CẤU TRÚC (không phải nội dung): tập perm_id + phân loại + số đoạn."""
        sig = "|".join(
            f"{f.perm_id}:{f.region_kind.value}:{f.para_count}"
            for f in sorted(self.fields, key=lambda x: x.ordinal)
        )
        return hashlib.sha256(sig.encode("utf-8")).hexdigest()

    def counts_by_kind(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for f in self.fields:
            out[f.region_kind.value] = out.get(f.region_kind.value, 0) + 1
        return out


@dataclass(frozen=True)
class WriteReport:
    """Kết quả một lần ghi — dùng cho audit và cho hậu kiểm."""

    perm_id: str
    mode: str  # 'inline' | 'block'
    paragraphs_touched: int
    runs_removed: int = 0
    rpr_preserved: bool = True
    old_text: str = ""
    new_text: str = ""


@dataclass(frozen=True)
class XmlDiff:
    """Một khác biệt XML nằm NGOÀI vùng cho phép — hậu kiểm phải trả về rỗng."""

    part: str
    location: str
    detail: str
