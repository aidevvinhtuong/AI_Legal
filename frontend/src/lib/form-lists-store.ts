/**
 * Cấu hình các list/dropdown trên form tạo review (IT — Configurations).
 * Persist mock qua localStorage.
 */

import { CONTRACT_TYPES, DOCUMENT_CATEGORIES } from "@/lib/mock-data";
import type { ContractTypeConfig, DiscountFlag, DocumentCategory } from "@/lib/types";

const STORAGE_KEY = "ai_econtract_form_lists_v5";

export type DiscountOption = {
  value: DiscountFlag;
  label: string;
};

/** Option dùng chung: Mã + Giá trị (Công ty, Hợp đồng tiêu chuẩn, …). */
export type CodeLabelOption = {
  id: string;
  code: string;
  label: string;
};

/** Tên hợp đồng — gắn với một Loại hợp đồng (document category). */
export type ContractNameOption = CodeLabelOption & {
  documentCategoryId: string;
};

export type FormListsState = {
  documentCategories: DocumentCategory[];
  discountOptions: DiscountOption[];
  contractTypes: ContractTypeConfig[];
  businessEntities: CodeLabelOption[];
  contractBases: CodeLabelOption[];
  contractNames: ContractNameOption[];
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

function contractName(
  categoryId: string,
  code: string,
  label: string
): ContractNameOption {
  return {
    id: `cn_${categoryId}_${code.toLowerCase()}`,
    code,
    label,
    documentCategoryId: categoryId,
  };
}

/** Master data: Tên hợp đồng theo Loại hợp đồng (HQP / RAW / MRO / CAP / LOG). */
const DEFAULT_CONTRACT_NAMES: ContractNameOption[] = [
  // HQP
  contractName("hqp", "HQP_TOUR", "Tour Du lịch"),
  contractName("hqp", "HQP_MEAL", "Cung cấp suất ăn"),
  contractName("hqp", "HQP_OFFICE", "Thuê Văn Phòng"),
  contractName("hqp", "HQP_CAR", "Thuê Xe"),
  contractName("hqp", "HQP_SPONSOR", "Tài Trợ"),
  contractName("hqp", "HQP_SW", "Phần Mềm & Hệ thống"),
  contractName("hqp", "HQP_ADS", "Bảng Quảng Cáo"),
  contractName("hqp", "HQP_EVENT", "Tổ chức sự kiện"),
  contractName("hqp", "HQP_OUTSOURCE", "Thuê Ngoài Lao Động"),
  contractName("hqp", "HQP_RECRUIT", "Tuyển Dụng"),
  contractName("hqp", "HQP_LEGAL", "Tư vấn luật, giấy phép"),
  contractName("hqp", "HQP_PROMO", "Hàng khuyến mãi"),
  contractName("hqp", "HQP_POSM", "POSM"),
  contractName("hqp", "HQP_OTHER", "Khác"),
  // RAW
  contractName("raw", "RAW_NVL2", "2. Nguyên vật liệu"),
  contractName("raw", "RAW_NVL", "Nguyên vật liệu"),
  contractName("raw", "RAW_TRADING", "Hàng trading"),
  contractName("raw", "RAW_OTHER", "Khác"),
  // MRO
  contractName("mro", "MRO_EQUIP", "Máy móc, Thiết bị, phụ tùng"),
  contractName("mro", "MRO_OTHER", "Khác"),
  // CAPEX (CAP)
  contractName("cap", "CAP_PM", "Quản lý và giám sát dự án"),
  contractName("cap", "CAP_CONSULT", "Tư vấn xây dựng"),
  contractName("cap", "CAP_BUILD", "Xây dựng"),
  contractName("cap", "CAP_MACH", "Máy móc, thiết bị"),
  contractName("cap", "CAP_OTHER", "Khác"),
  // LOG
  contractName("log", "LOG_TRANS", "Vận chuyển"),
  contractName("log", "LOG_WAREHOUSE", "Thuê kho"),
  contractName("log", "LOG_OTHER", "Khác"),
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

function normalizeContractNames(
  list: Array<Partial<ContractNameOption> & CodeLabelOption> | undefined,
  fallback: ContractNameOption[],
  categories: DocumentCategory[]
): ContractNameOption[] {
  const source = pickList(list, fallback);
  const defaultCat =
    categories[0]?.id || fallback[0]?.documentCategoryId || "";
  const catIds = new Set(categories.map((c) => c.id));
  return source.map((n, i) => {
    const cat =
      (n.documentCategoryId && catIds.has(n.documentCategoryId)
        ? n.documentCategoryId
        : null) ||
      fallback[i]?.documentCategoryId ||
      defaultCat;
    return {
      id: n.id,
      code: n.code,
      label: n.label,
      documentCategoryId: cat,
    };
  });
}

export function loadFormLists(): FormListsState {
  const fallback = defaultFormLists();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FormListsState>;
    const documentCategories = pickList(
      parsed.documentCategories,
      fallback.documentCategories
    );
    return {
      documentCategories,
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
      contractNames: normalizeContractNames(
        parsed.contractNames,
        fallback.contractNames,
        documentCategories
      ),
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
