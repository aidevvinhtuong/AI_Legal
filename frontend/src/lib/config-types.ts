import type { ContractGroup } from "@/lib/types";

/** Vòng đời cấu hình (checklist / Approval Matrix) — dùng ở màn chi tiết. */
export type ConfigLifecycle = "draft" | "published" | "archived";

/** Nhóm hợp đồng cha — chứa nhiều loại HĐ con (line). */
export interface ContractParentCategory {
  id: string;
  label: string;
  description?: string;
  /** Ảnh hưởng requireTemplateMatch / group của loại con tạo mới. */
  group?: ContractGroup;
}

export const CONTRACT_PARENT_CATEGORIES: ContractParentCategory[] = [
  {
    id: "purchase",
    label: "Hợp đồng mua hàng",
    description: "Các loại hợp đồng con thuộc nhóm mua hàng / khung",
    group: "framework",
  },
  {
    id: "vendor",
    label: "Hợp đồng NCC",
    description: "Các loại hợp đồng con với nhà cung cấp",
    group: "vendor",
  },
];

/** Loại điều khoản trong checklist. */
export type ClauseKind = "required" | "forbidden" | "recommended";

/**
 * Mức nghiêm trọng khi vi phạm.
 * - block: chặn / trừ nặng % tin cậy (rule-based + semantic)
 * - warn_high / warn_low: cảnh báo, không block submit
 */
export type ClauseSeverity = "block" | "warn_high" | "warn_low";

/** Điều kiện áp dụng có điều kiện cho một điều khoản. */
export interface ClauseCondition {
  /** Áp dụng khi giá trị HĐ >= ngưỡng (VND). */
  minContractValue?: number;
  /** Áp dụng khi giá trị HĐ < ngưỡng. */
  maxContractValue?: number;
  /** VD: foreign_vendor | domestic_vendor | any */
  partnerType?: "foreign_vendor" | "domestic_vendor" | "any";
  /** Ghi chú điều kiện (hiển thị UI). */
  note?: string;
}

/**
 * Một điều khoản trong checklist — đủ để AI / rule-based dùng.
 */
export interface ChecklistClause {
  id: string;
  /** Mã điều khoản ổn định giữa các version (VD: PAY-001). */
  code: string;
  /** Tên hiển thị. */
  name: string;
  kind: ClauseKind;
  severity: ClauseSeverity;
  /**
   * Văn bản mẫu chuẩn (Ideal) — dùng cho cả đối chiếu ngữ nghĩa và đề xuất sửa của AI.
   */
  standardText: string;
  /** Phương án chấp nhận được khi Ideal không phù hợp bối cảnh. */
  fallback?: string;
  /**
   * Ngưỡng walk-away — dưới mức này AI không tự đề xuất câu chữ thay thế,
   * chỉ cảnh báo và yêu cầu leo thang.
   */
  redLine?: string;
  /** Lý do nghiệp vụ đằng sau vị thế Ideal / Fallback / Red Line. */
  rationale?: string;
  /** Tier Approval Matrix khi deal cần đi dưới Fallback (label, VD: Director). */
  approvalLevelOnFallbackBreach?: string;
  /** Từ khóa / pattern cho tầng rule-based. */
  keywords: string[];
  /** Regex patterns (string) — rule-based. */
  patterns: string[];
  /** Điều kiện áp dụng (optional). */
  condition?: ClauseCondition;
  /**
   * Field / Content Control id tương ứng (nếu nằm trong field mở).
   * AI nối đề xuất Loại A vào field này.
   */
  contentControlId?: string;
  /** Bật tầng semantic (LLM) cho điều khoản này. */
  enableSemantic: boolean;
  /** Bật tầng rule-based. */
  enableRuleBased: boolean;
  sortOrder: number;
  active: boolean;
}

/** Clause thiếu Fallback / Red Line / Rationale — hiển thị badge cảnh báo. */
export function isClausePlaybookIncomplete(c: ChecklistClause): boolean {
  return !c.fallback?.trim() || !c.redLine?.trim() || !c.rationale?.trim();
}

export interface ApprovalMatrixTier {
  id: string;
  maxValueInclusive: number | null; // null = không giới hạn trên
  label: string; // Manager | Director | BOD
}

export interface ApprovalMatrixConfig {
  id: string;
  name: string;
  /** true = áp dụng chung toàn hệ thống; false = gắn theo loại HĐ qua linkage */
  scope: "global" | "per_contract_type";
  lifecycle: ConfigLifecycle;
  version: number;
  tiers: ApprovalMatrixTier[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedBy?: string;
}

/**
 * Một phiên bản cấu hình theo loại hợp đồng.
 * Sprint 1: sửa trực tiếp + Lưu — không workflow Draft/Publish.
 */
export interface ContractTypeConfigVersion {
  id: string;
  /** Khóa nghiệp vụ loại HĐ (ổn định). */
  contractTypeId: string;
  /** Loại HĐ cha — một cha có nhiều loại con (line). */
  parentCategoryId: string;
  label: string;
  group: ContractGroup;
  lifecycle: ConfigLifecycle;
  version: number;
  /** Bắt buộc khớp template (HĐ khung). */
  requireTemplateMatch: boolean;
  /** Tên file template mẫu (mock). */
  templateFileName?: string;
  /** Checklist điều khoản. */
  clauses: ChecklistClause[];
  /**
   * Approval Matrix áp dụng cho loại này.
   * null = dùng matrix global mặc định.
   */
  approvalMatrixId: string | null;
  /**
   * Cơ chế AI 2 tầng — metadata để debug / hiển thị.
   * Rule-based luôn chạy trước; semantic dùng LLM Local.
   */
  aiTiers: {
    ruleBasedEnabled: boolean;
    semanticEnabled: boolean;
    notes?: string;
  };
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  publishedAt?: string;
  publishedBy?: string;
  /** Kết quả test preview gần nhất (tuỳ chọn). */
  lastTestPreview?: {
    sampleFileName: string;
    testedAt: string;
    testedBy: string;
    summary: string;
    passCount: number;
    failCount: number;
    warnCount: number;
  };
}

export type ConfigAuditAction =
  | "create_draft"
  | "update_clause"
  | "add_clause"
  | "remove_clause"
  | "update_meta"
  | "link_matrix"
  | "test_preview"
  | "publish"
  | "archive"
  | "import_excel"
  | "export_excel";

export interface ConfigAuditEntry {
  id: string;
  configVersionId: string;
  contractTypeId: string;
  action: ConfigAuditAction;
  actorName: string;
  actorRole: string;
  at: string;
  /** Mã điều khoản nếu liên quan. */
  clauseCode?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  note?: string;
}

/** Phân quyền cấu hình (khác RBAC xem hợp đồng). */
export interface ConfigPermission {
  role: "legal" | "legal_lead" | "purchasing" | "admin" | "it";
  canView: boolean;
  /** Quyền sửa / lưu cấu hình (tên cũ canEditDraft giữ tương thích). */
  canEditDraft: boolean;
  canImportExport: boolean;
  canViewAudit: boolean;
}

export const DEFAULT_CONFIG_PERMISSIONS: ConfigPermission[] = [
  {
    role: "legal",
    canView: true,
    canEditDraft: true,
    canImportExport: true,
    canViewAudit: true,
  },
  /** @deprecated — gộp vào Legal; giữ để session cũ không lỗi. */
  {
    role: "legal_lead",
    canView: true,
    canEditDraft: true,
    canImportExport: true,
    canViewAudit: true,
  },
  {
    role: "purchasing",
    canView: false,
    canEditDraft: false,
    canImportExport: false,
    canViewAudit: false,
  },
  {
    role: "admin",
    canView: true,
    canEditDraft: true,
    canImportExport: true,
    canViewAudit: true,
  },
  {
    role: "it",
    canView: true,
    canEditDraft: true,
    canImportExport: true,
    canViewAudit: true,
  },
];
