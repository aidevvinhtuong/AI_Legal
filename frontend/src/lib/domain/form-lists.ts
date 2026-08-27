/**
 * Kiểu dữ liệu & helper thuần cho Form lists.
 *
 * Không còn store: master data (Loại hợp đồng, Tên hợp đồng, Công ty, Hợp đồng
 * tiêu chuẩn, Loại giá trị, Chiết khấu) do backend nắm giữ và trả qua
 * `/api/v1/form-lists` — xem `form-lists-service`.
 */

import type { ContractTypeConfig, DiscountFlag, DocumentCategory } from "@/lib/domain/types";

export type FormListItemStatus = "active" | "archived";

export type DiscountOption = {
  value: DiscountFlag;
  label: string;
};

/** Option dùng chung: Mã + Giá trị (Công ty, Hợp đồng tiêu chuẩn, …). */
export type CodeLabelOption = {
  id: string;
  code: string;
  label: string;
  /** archived = ẩn khỏi form tạo HĐ; vẫn giữ để HĐ cũ tham chiếu. */
  status?: FormListItemStatus;
};

/** Tên hợp đồng — gắn với một Loại hợp đồng (document category). */
export type ContractNameOption = CodeLabelOption & {
  documentCategoryId: string;
};

export type FormListKind =
  | "documentCategories"
  | "contractTypes"
  | "contractNames"
  | "businessEntities"
  | "contractBases";

export const FORM_LIST_KINDS: FormListKind[] = [
  "documentCategories",
  "contractTypes",
  "contractNames",
  "businessEntities",
  "contractBases",
];

export function isFormListItemArchived(
  item: { status?: string } | null | undefined
): boolean {
  return item?.status === "archived";
}

export type FormListsState = {
  documentCategories: DocumentCategory[];
  discountOptions: DiscountOption[];
  contractTypes: ContractTypeConfig[];
  businessEntities: CodeLabelOption[];
  contractBases: CodeLabelOption[];
  contractNames: ContractNameOption[];
};

/**
 * Số HĐ đang tham chiếu từng mục — khoá `"<kind>:<id>"`.
 *
 * Backend là nơi chốt luật "đang dùng thì chỉ được Lưu trữ, không được Xoá";
 * bản đồ này chỉ để UI hiện trước con số và làm mờ nút Xoá.
 */
export type FormListUsageMap = Record<string, number>;

export function usageKey(kind: FormListKind, id: string): string {
  return `${kind}:${id}`;
}

export function getFormListUsage(
  usage: FormListUsageMap | null | undefined,
  kind: FormListKind,
  id: string
): number {
  if (!usage || !id) return 0;
  return usage[usageKey(kind, id)] ?? 0;
}

export function slugId(prefix: string, label: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${prefix}_${base || Date.now()}`;
}
