/**
 * Form lists (IT Configurations) — client service. Nguồn dữ liệu là
 * REST /api/v1/form-lists (backend seed và lưu trữ).
 */

import { api } from "@/lib/api";
import {
  FORM_LIST_KINDS,
  usageKey,
  type FormListUsageMap,
  type FormListsState,
} from "@/lib/domain/form-lists";

export type { FormListsState, FormListUsageMap };

export async function fetchFormLists(): Promise<FormListsState> {
  // `includeArchived=true`: đây là màn quản trị, phải thấy cả mục đã lưu trữ thì
  // nút "Hiện mục đã lưu trữ" và nút Khôi phục mới có gì để hiện. Dropdown trên
  // form Tạo tài liệu dùng `/catalogs`, vốn đã lọc sẵn chỉ còn `active`.
  return api.get(
    "/api/v1/form-lists?includeArchived=true"
  ) as Promise<FormListsState>;
}

export async function persistFormLists(
  state: FormListsState
): Promise<FormListsState> {
  return api.put("/api/v1/form-lists", state) as Promise<FormListsState>;
}

/**
 * Số hợp đồng đang tham chiếu từng mục danh mục.
 *
 * Backend mới chỉ có endpoint đếm theo từng mục, nên ở đây fan-out song song.
 * Chấp nhận được vì đây là màn quản trị của IT (vài chục mục, mở không thường
 * xuyên). Mục nào gọi lỗi thì coi như 0 — backend vẫn là nơi chặn thật khi Lưu.
 */
export async function fetchFormListUsage(
  state: FormListsState
): Promise<FormListUsageMap> {
  const targets = FORM_LIST_KINDS.flatMap((kind) =>
    (state[kind] as { id: string }[]).map((item) => ({ kind, id: item.id }))
  ).filter((t) => t.id);

  const entries = await Promise.all(
    targets.map(async ({ kind, id }) => {
      try {
        const res = (await api.get(
          `/api/v1/form-lists/${kind}/${encodeURIComponent(id)}/usage`
        )) as { usageCount?: number };
        return [usageKey(kind, id), Number(res?.usageCount) || 0] as const;
      } catch {
        return [usageKey(kind, id), 0] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}
