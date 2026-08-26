"""
Danh mục Form lists.

Hai nhóm endpoint cho hai người dùng khác nhau:

  - `/catalogs/*` — chỉ đọc, ai đăng nhập cũng gọi được, phục vụ dropdown trên
    form Tạo tài liệu. Mặc định **chỉ trả mục `active`**: giá trị đã lưu trữ
    phải biến mất khỏi form nhưng vẫn còn cho hợp đồng cũ tham chiếu.
  - `/form-lists/*` — CRUD từng mục, cần quyền `form_lists`.

`PUT /form-lists` ghi cả bảng một lượt vì màn Configurations của IT sửa trên một
state duy nhất rồi bấm Lưu. Nó **không** phải đường ghi song song: bên trong nó
diff với DB rồi gọi đúng các thao tác per-item ở dưới, kèm nguyên vẹn luật
"đang có hợp đồng dùng thì chỉ được Lưu trữ, không được Xoá".

Đánh đổi đã biết: hai người sửa hai khối khác nhau cùng lúc thì người lưu sau
đè người lưu trước. Chấp nhận được vì đây là màn quản trị một người dùng của IT;
khi cần chặt hơn thì FE chuyển sang gọi các endpoint per-item — chúng vẫn còn
đây và vẫn là đường được khuyến nghị.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require
from app.domain.enums import Permission
from app.domain.errors import ConflictError, NotFoundError, ValidationError
from app.infra.models import CATALOG_KINDS, CatalogItem, ContractReview

router = APIRouter(prefix="/api/v1", tags=["catalogs"])


def _item_out(item: CatalogItem) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": item.slug,
        "code": item.code,
        "label": item.label,
        "status": item.status,
    }
    if item.kind == "contractNames":
        out["documentCategoryId"] = item.parent_slug
    if item.kind == "discountOptions":
        out["value"] = item.slug
    out.update(item.attrs or {})
    return out


def _query(db, kind: str, *, include_archived: bool) -> list[CatalogItem]:
    stmt = select(CatalogItem).where(CatalogItem.kind == kind)
    if not include_archived:
        stmt = stmt.where(CatalogItem.status == "active")
    return list(db.execute(stmt.order_by(CatalogItem.sort_order, CatalogItem.label)).scalars())


@router.get("/catalogs")
def all_catalogs(
    principal: CurrentUser,
    db: DbSession,
    includeArchived: bool = Query(False),  # noqa: N803 — khớp query param của FE
) -> dict[str, list[dict[str, Any]]]:
    """Trả một lượt cả 6 khối — đúng hình dạng `FormListsState` của FE."""
    del principal
    return {
        kind: [_item_out(i) for i in _query(db, kind, include_archived=includeArchived)]
        for kind in CATALOG_KINDS
    }


@router.get("/form-lists")
def form_lists_state(
    principal: CurrentUser,
    db: DbSession,
    includeArchived: bool = Query(False),  # noqa: N803
) -> dict[str, list[dict[str, Any]]]:
    """
    Bí danh của `/catalogs` — FE gọi tên này (`fetchFormLists`).

    Giữ cả hai vì hai cái tên phục vụ hai ngữ cảnh: «catalogs» khi đọc để đổ
    dropdown, «form lists» khi IT quản trị. Cùng một dữ liệu, không nhân bản
    logic.
    """
    return all_catalogs(principal, db, includeArchived)


@router.get("/catalogs/{kind}")
def one_catalog(
    kind: str,
    principal: CurrentUser,
    db: DbSession,
    includeArchived: bool = Query(False),  # noqa: N803
    categoryId: str | None = Query(None),  # noqa: N803
) -> list[dict[str, Any]]:
    del principal
    if kind not in CATALOG_KINDS:
        raise NotFoundError(f"Danh mục “{kind}”")
    items = _query(db, kind, include_archived=includeArchived)
    if categoryId and kind == "contractNames":
        items = [i for i in items if i.parent_slug == categoryId]
    return [_item_out(i) for i in items]


# Sáu lối tắt cho form Tạo tài liệu. FE gọi từng danh mục bằng tên riêng
# (`/document-categories`, `/business-entities`…) thay vì `/catalogs/{kind}`.
# Giữ cả hai: tên riêng đọc dễ hơn ở nơi gọi, `/catalogs/{kind}` tiện khi cần
# duyệt theo tham số. Cùng một truy vấn, không nhân bản logic.
_ALIASES = {
    "document-categories": "documentCategories",
    "contract-names": "contractNames",
    "contract-types": "contractTypes",
    "business-entities": "businessEntities",
    "contract-bases": "contractBases",
    "discount-options": "discountOptions",
}


def _make_alias(path: str, kind: str):
    def handler(
        principal: CurrentUser,
        db: DbSession,
        includeArchived: bool = Query(False),  # noqa: N803
        categoryId: str | None = Query(None),  # noqa: N803
    ) -> list[dict[str, Any]]:
        del principal
        items = _query(db, kind, include_archived=includeArchived)
        if categoryId and kind == "contractNames":
            items = [i for i in items if i.parent_slug == categoryId]
        return [_item_out(i) for i in items]

    handler.__name__ = f"list_{kind}"
    handler.__doc__ = f"Danh mục “{kind}” — bí danh của `/catalogs/{kind}`."
    router.add_api_route(f"/{path}", handler, methods=["GET"], summary=f"Danh mục {kind}")


for _path, _kind in _ALIASES.items():
    _make_alias(_path, _kind)


class CatalogItemIn(BaseModel):
    id: str | None = None
    code: str = ""
    label: str = Field(min_length=1)
    documentCategoryId: str | None = None  # noqa: N815
    attrs: dict[str, Any] = Field(default_factory=dict)
    sortOrder: int = 0  # noqa: N815


def _usage_count(db, item: CatalogItem) -> int:
    """Số hợp đồng đang tham chiếu — quyết định được Xoá hay chỉ được Lưu trữ."""
    if item.kind == "contractNames":
        return db.query(ContractReview).filter(ContractReview.contract_type_id == item.slug).count()
    key = {
        "documentCategories": "documentCategoryId",
        "businessEntities": "businessEntityId",
        "contractBases": "contractBaseId",
        "contractTypes": "contractTypeId",
    }.get(item.kind)
    if key is None:
        return 0
    return db.query(ContractReview).filter(ContractReview.intake[key].astext == item.slug).count()


# Khoá do `_item_out` sinh ra ở cấp cao nhất. Mọi khoá KHÁC trong payload là cờ
# riêng của khối (`group`, `requireTemplateMatch`, `hasChecklist`…) và được gom
# vào `attrs` — nhờ vậy thêm một cờ mới ở FE không phải sửa backend.
_RESERVED_KEYS = {"id", "code", "label", "status", "documentCategoryId", "value"}


def _slug_of(raw: dict[str, Any]) -> str:
    """`discountOptions` định danh bằng `value`; năm khối còn lại bằng `id`."""
    return str(raw.get("id") or raw.get("value") or "").strip()


def _apply_kind(db, kind: str, items: list[dict[str, Any]]) -> None:
    """
    Đồng bộ một khối về đúng `items`.

    Thứ tự trong mảng chính là `sort_order` — panel cho kéo thả nên vị trí phải
    lưu được, không suy ra từ nhãn.
    """
    current = {i.slug: i for i in _query(db, kind, include_archived=True)}
    seen: set[str] = set()

    for index, raw in enumerate(items):
        slug = _slug_of(raw)
        if not slug:
            raise ValidationError(f"Danh mục “{kind}”: có mục thiếu id")
        label = str(raw.get("label") or "").strip()
        if not label:
            raise ValidationError(f"Danh mục “{kind}”: mục “{slug}” thiếu nhãn")
        seen.add(slug)

        # FE dùng bộ trạng thái riêng cho `contractTypes`
        # (`draft`/`published`/`archived`); DB chỉ phân biệt còn dùng hay đã lưu
        # trữ, nên quy về hai giá trị thay vì đẻ thêm một trục trạng thái nữa.
        status = "archived" if raw.get("status") == "archived" else "active"
        attrs = {k: v for k, v in raw.items() if k not in _RESERVED_KEYS}

        item = current.get(slug)
        if item is None:
            if kind == "discountOptions":
                raise ValidationError("Danh mục chiết khấu cố định yes/no — chỉ sửa được nhãn")
            db.add(
                CatalogItem(
                    kind=kind,
                    slug=slug,
                    code=str(raw.get("code") or slug.upper()),
                    label=label,
                    status=status,
                    parent_slug=raw.get("documentCategoryId"),
                    attrs=attrs,
                    sort_order=index,
                )
            )
            continue

        item.label = label
        item.sort_order = index
        if kind != "discountOptions":
            item.code = str(raw.get("code") or item.code)
            item.status = status
            item.parent_slug = raw.get("documentCategoryId") or item.parent_slug
            item.attrs = attrs

    # Biến mất khỏi payload = người dùng bấm Xoá. Cùng một luật với DELETE
    # per-item: đã có hợp đồng tham chiếu thì không xoá, vì mất dấu vết hợp đồng
    # đó đã được tạo theo giá trị danh mục nào.
    blocked: list[str] = []
    for slug, item in current.items():
        if slug in seen:
            continue
        if kind == "discountOptions":
            raise ValidationError("Không xoá được mục của danh mục chiết khấu")
        if _usage_count(db, item):
            blocked.append(item.label)
            continue
        db.delete(item)
    if blocked:
        raise ConflictError(
            "Đang có hợp đồng dùng các giá trị sau nên không xoá được, "
            f"hãy Lưu trữ thay vì Xoá: {', '.join(blocked)}",
            code="catalog_item_in_use",
        )


@router.put("/form-lists", dependencies=[Depends(require(Permission.FORM_LISTS))])
def save_form_lists(
    payload: dict[str, list[dict[str, Any]]],
    principal: CurrentUser,
    db: DbSession,
) -> dict[str, list[dict[str, Any]]]:
    """
    Ghi cả sáu khối một lượt — đúng cách màn Configurations của IT hoạt động.

    Khối nào không có trong payload thì **không đụng tới**, chứ không coi là
    "xoá sạch khối đó": FE gửi thiếu một khoá vì lỗi hiển nhiên hơn nhiều so với
    việc âm thầm xoá toàn bộ một danh mục.
    """
    del principal
    unknown = sorted(set(payload) - set(CATALOG_KINDS))
    if unknown:
        raise ValidationError(f"Danh mục không tồn tại: {', '.join(unknown)}")

    for kind in CATALOG_KINDS:
        items = payload.get(kind)
        if items is None:
            continue
        if not isinstance(items, list):
            raise ValidationError(f"Danh mục “{kind}” phải là một mảng")
        _apply_kind(db, kind, items)

    db.flush()
    return {
        kind: [_item_out(i) for i in _query(db, kind, include_archived=True)]
        for kind in CATALOG_KINDS
    }


@router.post("/form-lists/{kind}", dependencies=[Depends(require(Permission.FORM_LISTS))])
def create_item(kind: str, payload: CatalogItemIn, db: DbSession) -> dict[str, Any]:
    if kind not in CATALOG_KINDS:
        raise NotFoundError(f"Danh mục “{kind}”")
    if kind == "discountOptions":
        raise ValidationError("Danh mục chiết khấu cố định yes/no — chỉ sửa được nhãn")

    slug = (payload.id or payload.code or payload.label).strip().lower().replace(" ", "_")
    existing = db.execute(
        select(CatalogItem).where(CatalogItem.kind == kind, CatalogItem.slug == slug)
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError(f"Mã “{slug}” đã tồn tại trong danh mục này")

    item = CatalogItem(
        kind=kind,
        slug=slug,
        code=payload.code or slug.upper(),
        label=payload.label,
        parent_slug=payload.documentCategoryId,
        attrs=payload.attrs,
        sort_order=payload.sortOrder,
    )
    db.add(item)
    db.flush()
    return _item_out(item)


@router.put("/form-lists/{kind}/{slug}", dependencies=[Depends(require(Permission.FORM_LISTS))])
def update_item(kind: str, slug: str, payload: CatalogItemIn, db: DbSession) -> dict[str, Any]:
    item = _get(db, kind, slug)
    item.label = payload.label
    if kind != "discountOptions":
        item.code = payload.code or item.code
        item.parent_slug = payload.documentCategoryId or item.parent_slug
        item.attrs = payload.attrs or item.attrs
        item.sort_order = payload.sortOrder or item.sort_order
    db.flush()
    return _item_out(item)


@router.post(
    "/form-lists/{kind}/{slug}/archive", dependencies=[Depends(require(Permission.FORM_LISTS))]
)
def archive_item(kind: str, slug: str, db: DbSession) -> dict[str, Any]:
    item = _get(db, kind, slug)
    item.status = "archived"
    db.flush()
    return _item_out(item)


@router.post(
    "/form-lists/{kind}/{slug}/restore", dependencies=[Depends(require(Permission.FORM_LISTS))]
)
def restore_item(kind: str, slug: str, db: DbSession) -> dict[str, Any]:
    item = _get(db, kind, slug)
    item.status = "active"
    db.flush()
    return _item_out(item)


@router.delete("/form-lists/{kind}/{slug}", dependencies=[Depends(require(Permission.FORM_LISTS))])
def delete_item(kind: str, slug: str, db: DbSession) -> dict[str, Any]:
    """Chỉ xoá được khi chưa có hợp đồng nào dùng — đã dùng thì phải Lưu trữ."""
    item = _get(db, kind, slug)
    used = _usage_count(db, item)
    if used:
        raise ConflictError(
            f"Có {used} hợp đồng đang dùng giá trị này — hãy Lưu trữ thay vì Xoá",
            code="catalog_item_in_use",
            usageCount=used,
        )
    db.delete(item)
    db.flush()
    return {"ok": True}


@router.get("/form-lists/{kind}/{slug}/usage")
def item_usage(kind: str, slug: str, principal: CurrentUser, db: DbSession) -> dict[str, int]:
    del principal
    return {"usageCount": _usage_count(db, _get(db, kind, slug))}


def _get(db, kind: str, slug: str) -> CatalogItem:
    if kind not in CATALOG_KINDS:
        raise NotFoundError(f"Danh mục “{kind}”")
    item = db.execute(
        select(CatalogItem).where(CatalogItem.kind == kind, CatalogItem.slug == slug)
    ).scalar_one_or_none()
    if item is None:
        raise NotFoundError(f"Mục “{slug}”")
    return item
