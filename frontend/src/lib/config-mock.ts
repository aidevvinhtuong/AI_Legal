import type {
  ApprovalMatrixConfig,
  ChecklistClause,
  ConfigAuditEntry,
  ContractParentCategory,
  ContractTypeConfigVersion,
} from "@/lib/config-types";
import { CONTRACT_PARENT_CATEGORIES } from "@/lib/config-types";

function clause(
  partial: Omit<
    ChecklistClause,
    "enableSemantic" | "enableRuleBased" | "active" | "sortOrder" | "patterns"
  > &
    Partial<
      Pick<
        ChecklistClause,
        | "enableSemantic"
        | "enableRuleBased"
        | "active"
        | "sortOrder"
        | "patterns"
        | "condition"
        | "contentControlId"
        | "fallback"
        | "redLine"
        | "rationale"
        | "approvalLevelOnFallbackBreach"
      >
    >
): ChecklistClause {
  return {
    patterns: [],
    enableSemantic: true,
    enableRuleBased: true,
    active: true,
    sortOrder: 0,
    ...partial,
  };
}

export const SEED_MATRICES: ApprovalMatrixConfig[] = [
  {
    id: "matrix_global_v1",
    name: "Ma trận phê duyệt toàn hệ thống",
    scope: "global",
    lifecycle: "published",
    version: 1,
    tiers: [
      { id: "t1", maxValueInclusive: 1_000_000_000, label: "Manager" },
      { id: "t2", maxValueInclusive: 5_000_000_000, label: "Director" },
      { id: "t3", maxValueInclusive: null, label: "BOD" },
    ],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    publishedAt: "2026-06-01T00:00:00.000Z",
    publishedBy: "Trần Thị Legal Lead",
  },
  {
    id: "matrix_framework_draft",
    name: "Matrix riêng — HĐ khung (Draft)",
    scope: "per_contract_type",
    lifecycle: "draft",
    version: 1,
    tiers: [
      { id: "t1", maxValueInclusive: 500_000_000, label: "Manager" },
      { id: "t2", maxValueInclusive: 3_000_000_000, label: "Director" },
      { id: "t3", maxValueInclusive: null, label: "BOD" },
    ],
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  },
];

const frameworkClauses: ChecklistClause[] = [
  clause({
    id: "c1",
    code: "PAY-001",
    name: "Thời hạn thanh toán ≤ 60 ngày",
    kind: "required",
    severity: "block",
    standardText:
      "Bên A thanh toán trong vòng không quá 60 ngày kể từ ngày nhận hóa đơn hợp lệ và biên bản nghiệm thu.",
    fallback:
      "Bên A thanh toán trong vòng không quá 75 ngày kể từ ngày nhận hóa đơn hợp lệ, với điều kiện có bảo lãnh thực hiện hợp đồng.",
    redLine:
      "Không chấp nhận thời hạn thanh toán gốc vượt 90 ngày hoặc thanh toán 100% trước nghiệm thu mà không có bảo lãnh.",
    rationale:
      "Chuẩn Purchasing SGVN: ≤60 ngày; 75 ngày chỉ khi có bảo lãnh; >90 ngày phải escalate Director.",
    approvalLevelOnFallbackBreach: "Director",
    keywords: ["thanh toán", "60 ngày", "nghiệm thu"],
    patterns: ["\\d{1,3}\\s*ngày"],
    contentControlId: "payment_days",
    sortOrder: 1,
  }),
  clause({
    id: "c2",
    code: "PAY-002",
    name: "Cấm thanh toán trước không điều kiện",
    kind: "forbidden",
    severity: "block",
    standardText:
      "Không được yêu cầu Bên A thanh toán trước toàn bộ giá trị mà không có bảo lãnh thực hiện / điều kiện nghiệm thu.",
    keywords: ["thanh toán trước", "trả trước 100%", "advance payment"],
    patterns: ["thanh\\s*toán\\s*trước", "advance\\s*payment"],
    sortOrder: 2,
  }),
  clause({
    id: "c3",
    code: "SEC-001",
    name: "Bảo mật ≥ 5 năm sau chấm dứt",
    kind: "recommended",
    severity: "warn_high",
    standardText:
      "Nghĩa vụ bảo mật duy trì tối thiểu 5 năm sau khi hợp đồng chấm dứt.",
    fallback:
      "Nghĩa vụ bảo mật duy trì tối thiểu 3 năm sau khi hợp đồng chấm dứt, áp dụng với thông tin thương mại nhạy cảm.",
    redLine:
      "Không chấp nhận thời hạn bảo mật dưới 2 năm hoặc điều khoản cho phép công bố công khai mà không có ngoại lệ pháp lý.",
    rationale:
      "Khuyến nghị mạnh với HĐ ≥ 1 tỷ; fallback 3 năm chỉ khi đối tác SME trong nước.",
    approvalLevelOnFallbackBreach: "Manager",
    keywords: ["bảo mật", "5 năm", "confidential"],
    sortOrder: 3,
    condition: {
      minContractValue: 1_000_000_000,
      note: "Khuyến nghị mạnh khi giá trị ≥ 1 tỷ",
    },
  }),
  clause({
    id: "c4",
    code: "TERM-001",
    name: "Thông báo chấm dứt ≥ 30 ngày bằng văn bản",
    kind: "required",
    severity: "warn_high",
    standardText:
      "Mỗi bên được đơn phương chấm dứt với thông báo trước tối thiểu 30 ngày bằng văn bản.",
    fallback:
      "Mỗi bên được đơn phương chấm dứt với thông báo trước tối thiểu 15 ngày bằng văn bản khi có sự kiện bất khả kháng kéo dài quá 60 ngày.",
    redLine:
      "Không chấp nhận chấm dứt tức thì không lý do hoặc thông báo dưới 7 ngày đối với HĐ khung đang hiệu lực.",
    rationale: "Bảo vệ chuỗi cung ứng; tránh đứt đột ngột.",
    approvalLevelOnFallbackBreach: "Director",
    keywords: ["chấm dứt", "30 ngày", "văn bản"],
    sortOrder: 4,
  }),
  clause({
    id: "c5",
    code: "FOR-001",
    name: "Điều khoản luật nước ngoài (NCC ngoại)",
    kind: "forbidden",
    severity: "warn_high",
    standardText:
      "Không chấp nhận điều khoản chọn luật nước ngoài làm luật áp dụng duy nhất khi đối tác là NCC nước ngoài (trừ khi Legal phê duyệt riêng).",
    keywords: ["governing law", "luật Singapore", "luật nước ngoài"],
    sortOrder: 5,
    condition: {
      partnerType: "foreign_vendor",
      note: "Chỉ áp dụng với NCC nước ngoài",
    },
  }),
];

export const SEED_CONFIG_VERSIONS: ContractTypeConfigVersion[] = [
  {
    id: "cfg_framework_goods_v2",
    contractTypeId: "framework_goods",
    parentCategoryId: "purchase",
    label: "Hợp đồng khung mua hàng",
    group: "framework",
    lifecycle: "published",
    version: 2,
    requireTemplateMatch: true,
    templateFileName: "Template_HD_Khung_MuaHang_v2.docx",
    clauses: frameworkClauses,
    approvalMatrixId: "matrix_global_v1",
    aiTiers: {
      ruleBasedEnabled: true,
      semanticEnabled: true,
      notes:
        "Tầng 1 rule-based (keywords/patterns) → Tầng 2 LLM Local semantic. Fail-fast template trước khi vào queue.",
    },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    createdBy: "Trần Thị Legal",
    updatedBy: "Trần Thị Legal Lead",
    publishedAt: "2026-07-01T00:00:00.000Z",
    publishedBy: "Trần Thị Legal Lead",
    lastTestPreview: {
      sampleFileName: "Sample_HD_Khung_OK.docx",
      testedAt: "2026-06-28T10:00:00.000Z",
      testedBy: "Trần Thị Legal",
      summary: "4 pass · 0 fail · 1 warn (SEC-001 khuyến nghị)",
      passCount: 4,
      failCount: 0,
      warnCount: 1,
    },
  },
  {
    id: "cfg_framework_goods_v3_draft",
    contractTypeId: "framework_goods",
    parentCategoryId: "purchase",
    label: "Hợp đồng khung mua hàng",
    group: "framework",
    lifecycle: "draft",
    version: 3,
    requireTemplateMatch: true,
    templateFileName: "Template_HD_Khung_MuaHang_v3.docx",
    clauses: [
      ...frameworkClauses,
      clause({
        id: "c6",
        code: "INS-001",
        name: "Bắt buộc bảo hiểm trách nhiệm",
        kind: "required",
        severity: "warn_low",
        standardText:
          "Bên B duy trì bảo hiểm trách nhiệm nghề nghiệp / sản phẩm trong suốt thời hạn hợp đồng.",
        keywords: ["bảo hiểm", "insurance"],
        sortOrder: 6,
      }),
    ],
    approvalMatrixId: "matrix_framework_draft",
    aiTiers: {
      ruleBasedEnabled: true,
      semanticEnabled: true,
      notes: "Draft — cần test preview trước khi Publish (thay thế v2).",
    },
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    createdBy: "Trần Thị Legal",
    updatedBy: "Trần Thị Legal",
  },
  {
    id: "cfg_framework_service_v1",
    contractTypeId: "framework_service",
    parentCategoryId: "purchase",
    label: "Hợp đồng khung dịch vụ",
    group: "framework",
    lifecycle: "published",
    version: 1,
    requireTemplateMatch: true,
    templateFileName: "Template_HD_Khung_DichVu_v1.docx",
    clauses: frameworkClauses.slice(0, 4),
    approvalMatrixId: "matrix_global_v1",
    aiTiers: {
      ruleBasedEnabled: true,
      semanticEnabled: true,
      notes: "Checklist khung dịch vụ — kế thừa clause lõi từ HĐ khung mua hàng.",
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    createdBy: "Trần Thị Legal",
    updatedBy: "Trần Thị Legal Lead",
    publishedAt: "2026-06-20T00:00:00.000Z",
    publishedBy: "Trần Thị Legal Lead",
    lastTestPreview: {
      sampleFileName: "Sample_HD_Khung_DV.docx",
      testedAt: "2026-06-18T10:00:00.000Z",
      testedBy: "Trần Thị Legal",
      summary: "3 pass · 0 fail · 1 warn",
      passCount: 3,
      failCount: 0,
      warnCount: 1,
    },
  },
  {
    id: "cfg_vendor_po_v1",
    contractTypeId: "vendor_po",
    parentCategoryId: "vendor",
    label: "Hợp đồng NCC / PO",
    group: "vendor",
    lifecycle: "published",
    version: 1,
    requireTemplateMatch: false,
    templateFileName: undefined,
    clauses: [
      clause({
        id: "v1",
        code: "NCC-PAY-001",
        name: "Thanh toán có nghiệm thu",
        kind: "required",
        severity: "warn_high",
        standardText: "Thanh toán chỉ thực hiện sau nghiệm thu / nhận hàng đúng PO.",
        keywords: ["nghiệm thu", "PO", "thanh toán"],
        sortOrder: 1,
      }),
      clause({
        id: "v2",
        code: "NCC-FOR-001",
        name: "Cấm phạt quá mức",
        kind: "forbidden",
        severity: "block",
        standardText: "Không chấp nhận mức phạt vi phạm vượt quá 8% giá trị hợp đồng.",
        keywords: ["phạt", "penalty", "8%"],
        sortOrder: 2,
      }),
    ],
    approvalMatrixId: null,
    aiTiers: {
      ruleBasedEnabled: true,
      semanticEnabled: true,
      notes: "Không bắt buộc khớp template; quét Content Control mở nếu có.",
    },
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    createdBy: "Trần Thị Legal",
    updatedBy: "Trần Thị Legal Lead",
    publishedAt: "2026-06-15T00:00:00.000Z",
    publishedBy: "Trần Thị Legal Lead",
  },
  {
    id: "cfg_vendor_other_draft",
    contractTypeId: "vendor_other",
    parentCategoryId: "vendor",
    label: "Hợp đồng NCC khác (chưa checklist chi tiết)",
    group: "vendor",
    lifecycle: "draft",
    version: 1,
    requireTemplateMatch: false,
    clauses: [],
    approvalMatrixId: null,
    aiTiers: {
      ruleBasedEnabled: false,
      semanticEnabled: true,
      notes: "Chưa có checklist — AI chỉ lớp ngữ nghĩa chung + cảnh báo tham khảo.",
    },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    createdBy: "Trần Thị Legal",
    updatedBy: "Trần Thị Legal",
  },
];

export const SEED_CONFIG_AUDIT: ConfigAuditEntry[] = [
  {
    id: "aud1",
    configVersionId: "cfg_framework_goods_v2",
    contractTypeId: "framework_goods",
    action: "publish",
    actorName: "Trần Thị Legal Lead",
    actorRole: "legal_lead",
    at: "2026-07-01T00:00:00.000Z",
    note: "Publish v2 — archive v1 ngầm",
  },
  {
    id: "aud2",
    configVersionId: "cfg_framework_goods_v3_draft",
    contractTypeId: "framework_goods",
    action: "add_clause",
    actorName: "Trần Thị Legal",
    actorRole: "legal",
    at: "2026-07-22T08:00:00.000Z",
    clauseCode: "INS-001",
    newValue: "Bắt buộc bảo hiểm trách nhiệm",
  },
  {
    id: "aud3",
    configVersionId: "cfg_framework_goods_v3_draft",
    contractTypeId: "framework_goods",
    action: "link_matrix",
    actorName: "Trần Thị Legal",
    actorRole: "legal",
    at: "2026-07-23T09:00:00.000Z",
    field: "approvalMatrixId",
    oldValue: "matrix_global_v1",
    newValue: "matrix_framework_draft",
  },
];

const CFG_KEY = "ai_econtract_config_versions_v3";
const MATRIX_KEY = "ai_econtract_matrices_v1";
const AUDIT_KEY = "ai_econtract_config_audit_v1";
const PARENT_KEY = "ai_econtract_parent_categories_v1";

function load<T>(key: string, seed: T[]): T[] {
  if (typeof window === "undefined") return seed;
  const raw = localStorage.getItem(key);
  if (!raw) {
    localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return seed;
  }
}

function save<T>(key: string, data: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
}

export function loadConfigVersions() {
  return load(CFG_KEY, SEED_CONFIG_VERSIONS);
}

export function saveConfigVersions(data: ContractTypeConfigVersion[]) {
  save(CFG_KEY, data);
}

export function loadMatrices() {
  return load(MATRIX_KEY, SEED_MATRICES);
}

export function saveMatrices(data: ApprovalMatrixConfig[]) {
  save(MATRIX_KEY, data);
}

export function loadConfigAudit() {
  return load(AUDIT_KEY, SEED_CONFIG_AUDIT);
}

export function saveConfigAudit(data: ConfigAuditEntry[]) {
  save(AUDIT_KEY, data);
}

/** Seed mặc định + loại cha user thêm (localStorage). */
export function loadParentCategories(): ContractParentCategory[] {
  if (typeof window === "undefined") {
    return CONTRACT_PARENT_CATEGORIES.map((p) => ({ ...p }));
  }
  const raw = localStorage.getItem(PARENT_KEY);
  if (!raw) {
    return CONTRACT_PARENT_CATEGORIES.map((p) => ({ ...p }));
  }
  try {
    const custom = JSON.parse(raw) as ContractParentCategory[];
    if (!Array.isArray(custom) || custom.length === 0) {
      return CONTRACT_PARENT_CATEGORIES.map((p) => ({ ...p }));
    }
    const byId = new Map<string, ContractParentCategory>();
    for (const p of CONTRACT_PARENT_CATEGORIES) byId.set(p.id, { ...p });
    for (const p of custom) {
      if (p?.id && p?.label) byId.set(p.id, { ...byId.get(p.id), ...p });
    }
    return Array.from(byId.values());
  } catch {
    return CONTRACT_PARENT_CATEGORIES.map((p) => ({ ...p }));
  }
}

export function saveParentCategories(data: ContractParentCategory[]) {
  save(PARENT_KEY, data);
}
