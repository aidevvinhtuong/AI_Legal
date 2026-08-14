"""
Đọc `.docx` → `FieldInventory`.

Đây là bước đầu tiên của mọi thứ: allow-list, structural binding, segmentation
cho AI, anchor cho comment và marker đều lấy dữ liệu từ đây.

BA CÁI BẪY đã gặp khi khảo sát template thật, module này xử lý tường minh:

  1. `permStart`/`permEnd` có thể nằm GIỮA các đoạn (bao cả khối) HOẶC nằm
     TRONG LÒNG một đoạn (inline field kiểu "trong vòng __03__ ngày").
     Bỏ sót nhánh inline thì 11/16 vùng của template bị đếm nhầm là rỗng.

  2. MỘT ĐOẠN CÓ THỂ CHỨA NHIỀU VÙNG MỞ. Đoạn 66 của hợp đồng THACO chứa cả
     vùng "30" lẫn vùng "ký hợp đồng". Nên khoá định danh field là `perm_id`,
     `para_id` một mình không đủ.

  3. "Rỗng" phải xét theo các `w:r` nằm BÊN TRONG cặp permStart/permEnd, không
     phải theo text của đoạn chứa nó. Vùng không có run bên trong thì writer
     không có `w:rPr` nào để kế thừa ⇒ không ghi được.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dc_field

from lxml.etree import _Element

from app.services.document.model import (
    DocumentProtection,
    FieldDescriptor,
    FieldInventory,
    Mechanism,
    ParagraphDescriptor,
    RegionKind,
)
from app.services.document.numbering_resolver import NumberingResolver
from app.services.document.ooxml import (
    COMMENTS_PART,
    DOCUMENT_PART,
    SETTINGS_PART,
    DocxPackage,
    paragraph_text,
    qn,
    run_text,
)

DEFAULT_ATOMIC_MAX_CHARS = 200


@dataclass
class _RegionAcc:
    """Trạng thái tích luỹ của một vùng mở trong lúc duyệt."""

    perm_id: str
    ordinal: int
    open_depth: int
    depth_seen: set[int] = dc_field(default_factory=set)
    para_ids: list[str] = dc_field(default_factory=list)
    inner_runs: list[str] = dc_field(default_factory=list)
    start_para_id: str | None = None
    end_para_id: str | None = None
    in_table: bool = False


class OoxmlReader:
    """
    Đọc một gói .docx. Không giữ trạng thái giữa các lần đọc — tạo mới mỗi lần.
    """

    def __init__(
        self,
        *,
        atomic_max_chars: int = DEFAULT_ATOMIC_MAX_CHARS,
        allow_cross_table_write: bool = False,
    ) -> None:
        self.atomic_max_chars = atomic_max_chars
        self.allow_cross_table_write = allow_cross_table_write

    # ── API chính ─────────────────────────────────────────────────────────
    def read(self, pkg: DocxPackage) -> FieldInventory:
        root = pkg.tree(DOCUMENT_PART)
        body = root.find(qn("w:body"))
        if body is None:
            from app.services.document.ooxml import DocxError

            raise DocxError("Thiếu w:body")

        paras_el, regions = self._walk(body)

        resolver = NumberingResolver(pkg)
        labels = resolver.resolve(paras_el)

        paragraphs = self._build_paragraphs(paras_el, labels, regions)
        fields = self._build_fields(regions)

        return FieldInventory(
            mechanism=self._detect_mechanism(body, regions),
            fields=fields,
            paragraphs=paragraphs,
            protection=self._read_protection(pkg),
            sdt_count=len(list(body.iter(qn("w:sdt")))),
            legacy_form_field_count=self._count_form_fields(body),
            comment_count=self._count_comments(pkg),
            has_tracked_changes=self._has_tracked_changes(body),
        )

    # ── Duyệt thân tài liệu, một lượt ─────────────────────────────────────
    def _walk(self, body: _Element) -> tuple[list[_Element], dict[str, _RegionAcc]]:
        """
        Duyệt theo đúng thứ tự tài liệu, thu:
          - danh sách w:p (để resolve numbering và dựng ParagraphDescriptor)
          - trạng thái từng vùng mở

        Trả về ({paragraphs}, {perm_id: _RegionAcc}).
        """
        paragraphs: list[_Element] = []
        regions: dict[str, _RegionAcc] = {}
        active: set[str] = set()
        para_of: dict[int, list[str]] = {}  # chỉ số đoạn → perm_id chạm vào đoạn đó
        order = 0

        def visit(node: _Element, depth: int) -> None:
            nonlocal order
            for child in node:
                tag = child.tag

                if tag == qn("w:tbl"):
                    visit(child, depth + 1)

                elif tag == qn("w:p"):
                    idx = len(paragraphs)
                    paragraphs.append(child)
                    touched = set(active)  # vùng đang mở từ trước đoạn này

                    # Duyệt bên trong đoạn theo đúng thứ tự văn bản
                    for sub in child.iter():
                        st = sub.tag
                        if st == qn("w:permStart"):
                            pid = sub.get(qn("w:id"))
                            if pid is None:
                                continue
                            order += 1
                            acc = regions.setdefault(
                                pid, _RegionAcc(perm_id=pid, ordinal=order, open_depth=depth)
                            )
                            acc.start_para_id = acc.start_para_id or _para_id(child)
                            active.add(pid)
                            touched.add(pid)
                        elif st == qn("w:permEnd"):
                            pid = sub.get(qn("w:id"))
                            if pid is not None and pid in regions:
                                regions[pid].end_para_id = _para_id(child)
                                active.discard(pid)
                        elif st == qn("w:r") and active:
                            txt = run_text(sub)
                            if txt:
                                for pid in active:
                                    regions[pid].inner_runs.append(txt)

                    for pid in touched:
                        acc = regions.get(pid)
                        if acc is None:
                            continue
                        pidv = _para_id(child)
                        if pidv and pidv not in acc.para_ids:
                            acc.para_ids.append(pidv)
                        acc.depth_seen.add(depth)
                        if depth > 0:
                            acc.in_table = True
                    if touched:
                        para_of[idx] = sorted(touched)

                # permStart/permEnd ở cấp khối, giữa các đoạn
                elif tag == qn("w:permStart"):
                    pid = child.get(qn("w:id"))
                    if pid is not None:
                        order += 1
                        regions.setdefault(
                            pid, _RegionAcc(perm_id=pid, ordinal=order, open_depth=depth)
                        )
                        active.add(pid)
                elif tag == qn("w:permEnd"):
                    pid = child.get(qn("w:id"))
                    if pid is not None:
                        active.discard(pid)

                elif tag in (qn("w:sdt"), qn("w:sdtContent"), qn("w:tr"), qn("w:tc")):
                    visit(child, depth + 1 if tag in (qn("w:tr"), qn("w:tc")) else depth)

                elif len(child):
                    visit(child, depth)

        visit(body, 0)
        self._para_map = para_of  # dùng lại ở _build_paragraphs
        return paragraphs, regions

    # ── Dựng kết quả ──────────────────────────────────────────────────────
    def _build_paragraphs(
        self,
        paras_el: list[_Element],
        labels: dict[int, str],
        regions: dict[str, _RegionAcc],
    ) -> list[ParagraphDescriptor]:
        out: list[ParagraphDescriptor] = []
        for idx, p in enumerate(paras_el):
            perm_ids = tuple(self._para_map.get(idx, ()))
            style_el = p.find(f"{qn('w:pPr')}/{qn('w:pStyle')}")
            in_table = any(anc.tag == qn("w:tbl") for anc in p.iterancestors())
            out.append(
                ParagraphDescriptor(
                    para_id=_para_id(p) or f"__idx{idx}",
                    ordinal=idx,
                    text=paragraph_text(p),
                    style_name=style_el.get(qn("w:val")) if style_el is not None else None,
                    numbering_label=labels.get(idx),
                    in_table=in_table,
                    is_open=bool(perm_ids),
                    perm_ids=perm_ids,
                )
            )
        return out

    def _build_fields(self, regions: dict[str, _RegionAcc]) -> list[FieldDescriptor]:
        out: list[FieldDescriptor] = []
        for acc in sorted(regions.values(), key=lambda a: a.ordinal):
            inner = "".join(acc.inner_runs)
            kind = self._classify(acc, inner)
            out.append(
                FieldDescriptor(
                    perm_id=acc.perm_id,
                    mechanism=Mechanism.PERMISSION_RANGE,
                    region_kind=kind,
                    writable=self._is_writable(kind),
                    ordinal=acc.ordinal,
                    inner_text=inner,
                    para_ids=tuple(acc.para_ids),
                    start_para_id=acc.start_para_id,
                    end_para_id=acc.end_para_id,
                    in_table=acc.in_table,
                )
            )
        return out

    def _classify(self, acc: _RegionAcc, inner: str) -> RegionKind:
        """Xem docstring RegionKind. Thứ tự kiểm tra là cố ý."""
        if not inner.strip():
            # Không có run bên trong ⇒ không có w:rPr để kế thừa ⇒ không ghi được
            return RegionKind.EMPTY
        if len(acc.depth_seen) > 1:
            # Bắt đầu ở độ sâu bảng này, kết thúc ở độ sâu khác
            return RegionKind.CROSS_TABLE
        if len(acc.para_ids) <= 1 and len(inner) <= self.atomic_max_chars:
            return RegionKind.ATOMIC_FIELD
        return RegionKind.BLOCK_REGION

    def _is_writable(self, kind: RegionKind) -> bool:
        if kind is RegionKind.EMPTY:
            return False
        if kind is RegionKind.CROSS_TABLE:
            return self.allow_cross_table_write  # van an toàn, mặc định tắt
        return True

    # ── Siêu dữ liệu ──────────────────────────────────────────────────────
    @staticmethod
    def _detect_mechanism(body: _Element, regions: dict[str, _RegionAcc]) -> Mechanism:
        if regions:
            return Mechanism.PERMISSION_RANGE
        if next(body.iter(qn("w:sdt")), None) is not None:
            return Mechanism.CONTENT_CONTROL
        if OoxmlReader._count_form_fields(body):
            return Mechanism.LEGACY_FORM_FIELD
        return Mechanism.NONE

    @staticmethod
    def _count_form_fields(body: _Element) -> int:
        """
        `w:fldChar` dùng cho MỌI field của Word (số trang, TOC, cross-reference).
        Legacy Form Field là những field có instruction FORMTEXT/FORMCHECKBOX/
        FORMDROPDOWN — chỉ đếm loại đó, nếu không sẽ báo nhầm.
        """
        count = 0
        for instr in body.iter(qn("w:instrText")):
            text = (instr.text or "").upper()
            if "FORMTEXT" in text or "FORMCHECKBOX" in text or "FORMDROPDOWN" in text:
                count += 1
        return count

    @staticmethod
    def _has_tracked_changes(body: _Element) -> bool:
        for tag in ("w:ins", "w:del", "w:moveFrom", "w:moveTo"):
            if next(body.iter(qn(tag)), None) is not None:
                return True
        return False

    @staticmethod
    def _count_comments(pkg: DocxPackage) -> int:
        root = pkg.tree_or_none(COMMENTS_PART)
        return 0 if root is None else len(list(root.iterfind(qn("w:comment"))))

    @staticmethod
    def _read_protection(pkg: DocxPackage) -> DocumentProtection | None:
        root = pkg.tree_or_none(SETTINGS_PART)
        if root is None:
            return None
        el = root.find(qn("w:documentProtection"))
        if el is None:
            return None
        enf = (el.get(qn("w:enforcement")) or "0").lower()
        return DocumentProtection(
            edit=el.get(qn("w:edit")),
            enforcement=enf in ("1", "true", "on"),
            has_password=bool(el.get(qn("w:hash")) or el.get(qn("w:salt"))),
        )


def _para_id(para: _Element) -> str | None:
    """`w14:paraId`. Word cấp cho mọi đoạn từ 2010 trở đi; '00000000' coi như không có."""
    value = para.get(qn("w14:paraId"))
    return value if value and value != "00000000" else None
