/**
 * Form lists (IT Configurations) — client service.
 * Mock: localStorage qua form-lists-store. Live: REST /api/form-lists.
 */

import { api, USE_MOCK } from "@/lib/api";
import {
  defaultFormLists,
  loadFormLists,
  saveFormLists as saveFormListsLocal,
  type FormListsState,
} from "@/lib/form-lists-store";

export type { FormListsState };
export { defaultFormLists };

export async function fetchFormLists(): Promise<FormListsState> {
  if (USE_MOCK) return loadFormLists();
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
  if (USE_MOCK) {
    saveFormListsLocal(state);
    return state;
  }
  return api.put("/api/v1/form-lists", state) as Promise<FormListsState>;
}

export async function resetFormLists(): Promise<FormListsState> {
  const next = defaultFormLists();
  return persistFormLists(next);
}
