/**
 * Cấu hình các list/dropdown trên form tạo review (IT — Configurations).
 * Persist mock qua localStorage.
 */

import { CONTRACT_TYPES, DOCUMENT_CATEGORIES } from "@/lib/mock-data";
import type { ContractTypeConfig, DiscountFlag, DocumentCategory } from "@/lib/types";

const STORAGE_KEY = "ai_econtract_form_lists_v3";

export type DiscountOption = {
  value: DiscountFlag;
  label: string;
};

/** Option dùng chung: Mã + Giá trị (Business Entity, Contract base, …). */
export type CodeLabelOption = {
  id: string;
  code: string;
  label: string;
};

export type FormListsState = {
  documentCategories: DocumentCategory[];
  discountOptions: DiscountOption[];
  contractTypes: ContractTypeConfig[];
  businessEntities: CodeLabelOption[];
  contractBases: CodeLabelOption[];
  contractNames: CodeLabelOption[];
};

const DEFAULT_DISCOUNT_OPTIONS: DiscountOption[] = [
  { value: "yes", label: "Có" },
  { value: "no", label: "Không" },
];

const DEFAULT_BUSINESS_ENTITIES: CodeLabelOption[] = [
  { id: "be_sgvn", code: "SGVN", label: "Saint-Gobain Vietnam" },
  { id: "be_vts", code: "VTS", label: "Vinh Tuong Saint-Gobain" },
  { id: "be_rigips", code: "RIGIPS", label: "Rigips Vietnam" },
];

const DEFAULT_CONTRACT_BASES: CodeLabelOption[] = [
  { id: "cb_framework", code: "FW", label: "Framework agreement" },
  { id: "cb_po", code: "PO", label: "Purchase order" },
  { id: "cb_spot", code: "SPOT", label: "Spot contract" },
];

const DEFAULT_CONTRACT_NAMES: CodeLabelOption[] = [
  { id: "cn_hdvt", code: "HDVT", label: "Hợp đồng vận tải" },
  { id: "cn_hddv", code: "HDDV", label: "Hợp đồng dịch vụ" },
  { id: "cn_hdmh", code: "HDMH", label: "Hợp đồng mua hàng" },
  { id: "cn_hdk", code: "HDK", label: "Hợp đồng khung" },
];

export function defaultFormLists(): FormListsState {
  return {
    documentCategories: DOCUMENT_CATEGORIES.map((c) => ({ ...c })),
    discountOptions: DEFAULT_DISCOUNT_OPTIONS.map((d) => ({ ...d })),
    contractTypes: CONTRACT_TYPES.map((t) => ({ ...t })),
    businessEntities: DEFAULT_BUSINESS_ENTITIES.map((d) => ({ ...d })),
    contractBases: DEFAULT_CONTRACT_BASES.map((d) => ({ ...d })),
    contractNames: DEFAULT_CONTRACT_NAMES.map((d) => ({ ...d })),
  };
}

function pickList<T>(parsed: T[] | undefined, fallback: T[]): T[] {
  return parsed?.length ? parsed : fallback;
}

export function loadFormLists(): FormListsState {
  const fallback = defaultFormLists();
  if (typeof window === "undefined") return fallback;
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("ai_econtract_form_lists_v2") ||
      localStorage.getItem("ai_econtract_form_lists_v1");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FormListsState>;
    return {
      documentCategories: pickList(
        parsed.documentCategories,
        fallback.documentCategories
      ),
      discountOptions: pickList(
        parsed.discountOptions,
        fallback.discountOptions
      ),
      contractTypes: pickList(parsed.contractTypes, fallback.contractTypes),
      businessEntities: pickList(
        parsed.businessEntities,
        fallback.businessEntities
      ),
      contractBases: pickList(parsed.contractBases, fallback.contractBases),
      contractNames: pickList(parsed.contractNames, fallback.contractNames),
    };
  } catch {
    return fallback;
  }
}

export function saveFormLists(state: FormListsState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
