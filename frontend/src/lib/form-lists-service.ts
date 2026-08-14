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
  return api.get("/api/v1/form-lists") as Promise<FormListsState>;
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
