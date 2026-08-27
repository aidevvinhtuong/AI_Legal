import { api } from "@/lib/api";
import {
  DEFAULT_CONFIG_PERMISSIONS,
  type ChecklistClause,
  type ConfigAuditAction,
  type ConfigAuditEntry,
  type ConfigLayer,
  type ConfigPermission,
  type ContractParentCategory,
  type ContractTypeConfigVersion,
  type ApprovalMatrixConfig,
  type SigningAuthorityRule,
} from "@/lib/config-types";
import type { ContractNameOption } from "@/lib/form-lists-store";
import { getSession } from "@/lib/session";
import type {
  ContractGroup,
  SignRecipient,
  UserRole,
} from "@/lib/types";




export function getConfigPermission(role?: UserRole): ConfigPermission {
  const session = getSession();
  const r = role || session?.role || "purchasing";
  const perms = session?.permissions;
  // Ưu tiên tick permissions trên user (IT gán)
  if (perms?.length) {
    const canConfig = perms.includes("contract_config");
    return {
      role: r === "it" ? "it" : r === "legal" ? "legal" : "purchasing",
      canView: canConfig,
      canEditDraft: canConfig,
      canImportExport: canConfig,
      canViewAudit: canConfig || r === "it",
    };
  }
  const mapped = r === "it" ? "it" : r === "legal" ? "legal" : "purchasing";
  // `mapped` luôn là một trong ba giá trị có sẵn trong bảng, nên `find` không
  // bao giờ trả `undefined` — nhánh sau chỉ để TypeScript yên tâm.
  //
  // Trước đây nhánh đó là `DEFAULT_CONFIG_PERMISSIONS[2]`, tức bám vào THỨ TỰ
  // mảng. Xoá `legal_lead` ở vòng C làm chỉ số 2 trượt từ `purchasing` sang
  // `admin`. **Chưa gây hậu quả** vì nhánh này không chạm tới được — nhưng đó
  // đúng là loại mã chỉ chờ ai đó nới `mapped` rộng ra là thành lỗ cấp quyền
  // thật, và lúc đó không có gì báo động.
  return (
    DEFAULT_CONFIG_PERMISSIONS.find((p) => p.role === mapped) ||
    DEFAULT_CONFIG_PERMISSIONS.find((p) => p.role === "purchasing")!
  );
}

function assertCanEditConfig(cfg: ContractTypeConfigVersion) {
  if (cfg.lifecycle === "archived") {
    throw new Error("Bản đã archive — không sửa được");
  }
}


export async function listConfigVersions(): Promise<ContractTypeConfigVersion[]> {
  return api.get("/api/v1/config/versions") as Promise<ContractTypeConfigVersion[]>;
}

export async function getConfigVersion(
  id: string
): Promise<ContractTypeConfigVersion> {
  return api.get(`/api/v1/config/versions/${id}`) as Promise<ContractTypeConfigVersion>;
}

export async function listMatrices(): Promise<ApprovalMatrixConfig[]> {
  return api.get("/api/v1/config/matrices") as Promise<ApprovalMatrixConfig[]>;
}

export async function listConfigAudit(
  contractTypeId?: string
): Promise<ConfigAuditEntry[]> {
  const q = contractTypeId
    ? `?contractTypeId=${encodeURIComponent(contractTypeId)}`
    : "";
  return api.get(`/api/v1/config/audit${q}`) as Promise<ConfigAuditEntry[]>;
}

export async function saveConfigDraft(
  config: ContractTypeConfigVersion
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền sửa cấu hình");
  assertCanEditConfig(config);

  return api.put(`/api/v1/config/versions/${config.id}`, config) as Promise<ContractTypeConfigVersion>;
}

export async function upsertClause(
  configId: string,
  clause: ChecklistClause,
  isNew: boolean
): Promise<ContractTypeConfigVersion> {
  const cfg = await getConfigVersion(configId);
  assertCanEditConfig(cfg);
  const clauses = isNew
    ? [...cfg.clauses, clause]
    : cfg.clauses.map((c) => (c.id === clause.id ? clause : c));
  const updated = await saveConfigDraft({ ...cfg, clauses });
  return updated;
}

export async function removeClause(
  configId: string,
  clauseId: string
): Promise<ContractTypeConfigVersion> {
  const cfg = await getConfigVersion(configId);
  assertCanEditConfig(cfg);
  const removed = cfg.clauses.find((c) => c.id === clauseId);
  const updated = await saveConfigDraft({
    ...cfg,
    clauses: cfg.clauses.filter((c) => c.id !== clauseId),
  });
  return updated;
}

export async function linkMatrix(
  configId: string,
  matrixId: string | null
): Promise<ContractTypeConfigVersion> {
  const cfg = await getConfigVersion(configId);
  assertCanEditConfig(cfg);
  const old = cfg.approvalMatrixId;
  const updated = await saveConfigDraft({
    ...cfg,
    approvalMatrixId: matrixId,
  });
  return updated;
}


/**
 * Loại hợp đồng cha = Form lists → Loại hợp đồng (documentCategories).
 * Không tạo loại cha riêng trên màn Cấu hình HĐ.
 */
export async function listParentCategories(): Promise<ContractParentCategory[]> {
  return api.get("/api/v1/config/parent-categories") as Promise<
    ContractParentCategory[]
  >;
}

/** Tên hợp đồng con = Form lists → contractNames (link documentCategoryId). Chỉ active. */
export async function listFormListContractNames(
  categoryId?: string
): Promise<ContractNameOption[]> {
  const q = categoryId
    ? `?categoryId=${encodeURIComponent(categoryId)}`
    : "";
  return api.get(`/api/v1/config/contract-names${q}`) as Promise<ContractNameOption[]>;
}

/** Suy ra lớp cấu hình khi seed cũ thiếu configLayer. */
export function resolveConfigLayer(
  cfg: ContractTypeConfigVersion
): ConfigLayer {
  if (cfg.configLayer === "parent" || cfg.configLayer === "child") {
    return cfg.configLayer;
  }
  return cfg.contractTypeId === cfg.parentCategoryId ? "parent" : "child";
}

export function isParentConfig(cfg: ContractTypeConfigVersion): boolean {
  return resolveConfigLayer(cfg) === "parent";
}

/** Bản active mới nhất theo khóa contractTypeId (cha hoặc con). */
export function pickChildLineConfig(
  versions: ContractTypeConfigVersion[],
  opts?: { includeArchived?: boolean }
): ContractTypeConfigVersion | null {
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const active = sorted.find((v) => v.lifecycle !== "archived");
  if (active) return active;
  return opts?.includeArchived ? sorted[0] : null;
}

/**
 * Bản cấu hình đang dùng của một khoá nghiệp vụ (loại cha hoặc tên HĐ con).
 *
 * Đọc từ `/api/v1/config/versions` chứ không từ cache cục bộ — cấu hình là dữ
 * liệu của Legal, sửa ở đâu thì mọi phiên phải thấy ngay.
 */
export async function findConfigByBusinessKey(
  contractTypeId: string,
  opts?: { includeArchived?: boolean }
): Promise<ContractTypeConfigVersion | null> {
  const all = await listConfigVersions();
  return pickChildLineConfig(
    all.filter((c) => c.contractTypeId === contractTypeId),
    opts
  );
}

export type MergedContractConfig = {
  parent: ContractTypeConfigVersion | null;
  child: ContractTypeConfigVersion | null;
  /** parent ∪ child — cùng code điều khoản thì child thắng. */
  clauses: ChecklistClause[];
  aiTiers: ContractTypeConfigVersion["aiTiers"];
  requireTemplateMatch: boolean;
  templateFileName?: string;
  approvalMatrixId: string | null;
  parentClauseCount: number;
  childClauseCount: number;
  overriddenCodes: string[];
};

/**
 * Gộp cấu hình loại cha + overlay tên HĐ con (AI runtime dùng kết quả này).
 */
export function mergeParentAndChildConfig(
  parent: ContractTypeConfigVersion | null,
  child: ContractTypeConfigVersion | null
): MergedContractConfig {
  const parentClauses = (parent?.clauses || []).filter((c) => c.active !== false);
  const childClauses = (child?.clauses || []).filter((c) => c.active !== false);
  const byCode = new Map<string, ChecklistClause>();
  const overriddenCodes: string[] = [];
  for (const c of parentClauses) byCode.set(c.code, c);
  for (const c of childClauses) {
    if (byCode.has(c.code)) overriddenCodes.push(c.code);
    byCode.set(c.code, c);
  }
  const clauses = Array.from(byCode.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)
  );

  const baseAi = parent?.aiTiers || {
    ruleBasedEnabled: true,
    semanticEnabled: true,
  };
  const aiTiers = child
    ? {
        ruleBasedEnabled: child.aiTiers.ruleBasedEnabled,
        semanticEnabled: child.aiTiers.semanticEnabled,
        notes: [parent?.aiTiers.notes, child.aiTiers.notes]
          .filter(Boolean)
          .join(" | "),
      }
    : { ...baseAi };

  return {
    parent,
    child,
    clauses,
    aiTiers,
    requireTemplateMatch:
      child?.requireTemplateMatch ?? parent?.requireTemplateMatch ?? false,
    templateFileName: child?.templateFileName || parent?.templateFileName,
    approvalMatrixId:
      child?.approvalMatrixId !== undefined && child?.approvalMatrixId !== null
        ? child.approvalMatrixId
        : parent?.approvalMatrixId ?? null,
    parentClauseCount: parentClauses.length,
    childClauseCount: childClauses.length,
    overriddenCodes,
  };
}


function categoryGroup(categoryId: string): ContractGroup {
  return categoryId === "log" || categoryId === "mro" ? "vendor" : "framework";
}

/**
 * Lấy / tạo checklist loại cha (documentCategories.id).
 * Mọi Tên hợp đồng con thuộc loại này được hưởng khi AI gộp.
 */
export async function ensureConfigForParentCategory(
  categoryId: string
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canView) throw new Error("Không có quyền xem cấu hình");

  // Không kiểm tra sự tồn tại của loại HĐ ở client: backend là nơi giữ danh mục
  // và trả 404 kèm thông báo nếu slug không có.
  return api.post(`/api/v1/config/parent-categories/${categoryId}/ensure`, {}) as Promise<ContractTypeConfigVersion>;
}

/**
 * Lấy / tạo overlay checklist cho một Tên hợp đồng (bổ sung / ghi đè cha).
 * contractTypeId = contractNames.id; AI gộp với checklist loại cha.
 */
export async function ensureConfigForContractName(
  contractNameId: string
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canView) throw new Error("Không có quyền xem cấu hình");

  return api.post(`/api/v1/config/contract-names/${contractNameId}/ensure`, {}) as Promise<ContractTypeConfigVersion>;
}

/**
 * @deprecated Loại hợp đồng cha lấy từ Form lists (documentCategories).
 */
export async function createParentContractCategory(_input: {
  label: string;
  description?: string;
  group?: ContractGroup;
}): Promise<ContractParentCategory> {
  throw new Error(
    "Không tạo loại cha tại đây — thêm Loại hợp đồng tại Configurations → Form lists."
  );
}

/**
 * @deprecated Thêm tên tại Form lists; cấu hình chính ở loại cha, overlay ở tên con.
 */
export async function createChildContractType(
  _parentCategoryId: string,
  _label: string
): Promise<ContractTypeConfigVersion> {
  throw new Error(
    "Không tạo loại HĐ tại đây — thêm Tên hợp đồng tại Configurations → Form lists, rồi cấu hình loại cha / overlay con."
  );
}

/**
 * Số HĐ đang tham chiếu một Tên hợp đồng — hỏi thẳng backend.
 *
 * Đây chỉ là gợi ý cho UI (làm mờ nút Xoá, hiện "đang dùng bởi n HĐ"). Luật
 * "đang dùng thì chỉ được Lưu trữ" do backend chốt lúc ghi, nên gọi lỗi ở đây
 * trả 0 chứ không chặn thao tác.
 */
export async function countReviewsUsingContractType(
  contractTypeId: string
): Promise<number> {
  try {
    const res = (await api.get(
      `/api/v1/form-lists/contractNames/${encodeURIComponent(contractTypeId)}/usage`
    )) as { usageCount?: number };
    return Number(res?.usageCount) || 0;
  } catch {
    return 0;
  }
}

/** Số HĐ thuộc một Loại hợp đồng cha (documentCategories.id). */
export async function countReviewsUsingParentCategory(
  categoryId: string
): Promise<number> {
  try {
    const res = (await api.get(
      `/api/v1/form-lists/documentCategories/${encodeURIComponent(categoryId)}/usage`
    )) as { usageCount?: number };
    return Number(res?.usageCount) || 0;
  } catch {
    return 0;
  }
}

/**
 * Lưu trữ Tên hợp đồng (Form lists) + overlay checklist (nếu có).
 * Ẩn khỏi form tạo HĐ. Không ảnh hưởng checklist loại cha.
 */
export async function archiveChildContractType(
  contractTypeId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền lưu trữ loại hợp đồng");

  await api.post(`/api/v1/config/contract-types/${contractTypeId}/archive`, {});
}

/** Lưu trữ checklist loại cha — các con vẫn hiện; AI chỉ còn overlay con (nếu có). */
export async function archiveParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền lưu trữ cấu hình loại cha");

  await api.post(`/api/v1/config/parent-categories/${categoryId}/archive`, {});
  return;
}

/**
 * Xóa overlay checklist của Tên hợp đồng — chỉ khi chưa có HĐ nào dùng.
 * Không xóa dòng Form lists; không xóa checklist loại cha.
 */
export async function deleteChildContractType(
  contractTypeId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền xóa loại hợp đồng");

  const usage = await countReviewsUsingContractType(contractTypeId);
  if (usage > 0) {
    throw new Error(
      `Tên hợp đồng đang được dùng bởi ${usage} HĐ — chỉ được Lưu trữ, không xóa checklist riêng.`
    );
  }

  await api.delete(`/api/v1/config/contract-types/${contractTypeId}`);
  return;
}

/** Xóa checklist loại cha — chặn nếu có HĐ thuộc loại. */
export async function deleteParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền xóa cấu hình loại cha");

  const usage = await countReviewsUsingParentCategory(categoryId);
  if (usage > 0) {
    throw new Error(
      `Loại HĐ đang có ${usage} HĐ — chỉ được Lưu trữ checklist loại cha, không xóa.`
    );
  }

  await api.delete(`/api/v1/config/parent-categories/${categoryId}`);
  return;
}

/** Khôi phục Tên hợp đồng đã lưu trữ → overlay + hiện lại trên form tạo HĐ. */
export async function restoreChildContractType(
  contractTypeId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền khôi phục loại hợp đồng");

  await api.post(`/api/v1/config/contract-types/${contractTypeId}/restore`, {});
  return;
}

/** Khôi phục checklist loại cha đã lưu trữ. */
export async function restoreParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền khôi phục cấu hình loại cha");

  await api.post(`/api/v1/config/parent-categories/${categoryId}/restore`, {});
  return;
}

/** Export checklist CSV (Excel-friendly). */
export function exportChecklistCsv(config: ContractTypeConfigVersion): string {
  const header = [
    "code",
    "name",
    "kind",
    "severity",
    "standardText",
    "keywords",
    "patterns",
    "contentControlId",
    "enableRuleBased",
    "enableSemantic",
    "minContractValue",
    "maxContractValue",
    "partnerType",
    "active",
  ].join(",");

  const rows = config.clauses.map((c) =>
    [
      c.code,
      csvEscape(c.name),
      c.kind,
      c.severity,
      csvEscape(c.standardText),
      csvEscape(c.keywords.join("|")),
      csvEscape(c.patterns.join("|")),
      c.contentControlId || "",
      c.enableRuleBased,
      c.enableSemantic,
      c.condition?.minContractValue ?? "",
      c.condition?.maxContractValue ?? "",
      c.condition?.partnerType || "",
      c.active,
    ].join(",")
  );


  return [header, ...rows].join("\n");
}

/** Import CSV rows (append/merge by code). */
export async function importChecklistCsv(
  configId: string,
  csvText: string
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canImportExport) throw new Error("Không có quyền import");

  const cfg = await getConfigVersion(configId);
  assertCanEditConfig(cfg);

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("File CSV trống");

  const imported: ChecklistClause[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols[0]) continue;
    imported.push({
      id: `imp_${Date.now()}_${i}`,
      code: cols[0],
      name: cols[1] || cols[0],
      kind: (cols[2] as ChecklistClause["kind"]) || "required",
      severity: (cols[3] as ChecklistClause["severity"]) || "warn_high",
      standardText: cols[4] || "",
      keywords: cols[5] ? cols[5].split("|").filter(Boolean) : [],
      patterns: cols[6] ? cols[6].split("|").filter(Boolean) : [],
      contentControlId: cols[7] || undefined,
      enableRuleBased: cols[8] !== "false",
      enableSemantic: cols[9] !== "false",
      condition:
        cols[10] || cols[11] || cols[12]
          ? {
              minContractValue: cols[10] ? Number(cols[10]) : undefined,
              maxContractValue: cols[11] ? Number(cols[11]) : undefined,
              partnerType:
                (cols[12] as "foreign_vendor" | "domestic_vendor" | "any") ||
                "any",
            }
          : undefined,
      sortOrder: cfg.clauses.length + i,
      active: cols[13] !== "false",
    });
  }

  const byCode = new Map(cfg.clauses.map((c) => [c.code, c]));
  for (const c of imported) {
    const existing = byCode.get(c.code);
    if (existing) {
      byCode.set(c.code, { ...existing, ...c, id: existing.id });
    } else {
      byCode.set(c.code, c);
    }
  }

  const updated = await saveConfigDraft({
    ...cfg,
    clauses: Array.from(byCode.values()),
  });
  return updated;
}

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

/** ——— Bảng phân quyền ký eContract (Công ty × Loại HĐ × min/max × quyền × user) ——— */

export async function listSigningRules(): Promise<SigningAuthorityRule[]> {
  return api.get("/api/v1/signing-rules") as Promise<SigningAuthorityRule[]>;
}


/** Validate toàn bộ bảng quy tắc ký. */
export function validateSigningRules(rules: SigningAuthorityRule[]): string[] {
  const errors: string[] = [];
  if (!rules.length) {
    errors.push("Cần ít nhất một dòng phân quyền ký");
    return errors;
  }
  rules.forEach((r, idx) => {
    const row = `Dòng ${idx + 1}`;
    if (!r.businessEntityIds?.length) {
      errors.push(`${row}: chọn ít nhất một Công ty`);
    }
    if (!r.documentCategoryId?.trim()) {
      errors.push(`${row}: chọn Loại hợp đồng`);
    }
    if (!(r.minValue >= 0) || Number.isNaN(r.minValue)) {
      errors.push(`${row}: Giá trị min không hợp lệ`);
    }
    if (r.maxValue != null) {
      if (!(r.maxValue >= 0) || Number.isNaN(r.maxValue)) {
        errors.push(`${row}: Giá trị max không hợp lệ`);
      } else if (r.maxValue < r.minValue) {
        errors.push(`${row}: Giá trị max phải ≥ min`);
      }
    }
    if (r.ecRole !== "reviewer" && r.ecRole !== "signer") {
      errors.push(`${row}: chọn quyền Xem xét hoặc Ký chính`);
    }
    if (!r.userId?.trim()) {
      errors.push(`${row}: chọn người từ user list`);
    }
    if (!r.personalName?.trim() || !r.email?.includes("@")) {
      errors.push(`${row}: user thiếu họ tên / email`);
    }
    if (r.ecRole === "signer" && (!r.signType || r.signType === "review")) {
      errors.push(`${row}: Ký chính cần hình thức ký hợp lệ`);
    }
  });
  return errors;
}

export async function saveSigningRules(
  rules: SigningAuthorityRule[]
): Promise<SigningAuthorityRule[]> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền sửa cấu hình");

  const errors = validateSigningRules(rules);
  if (errors.length) throw new Error(errors[0]);

  const data = (await api.put("/api/v1/signing-rules", { rules })) as
    | SigningAuthorityRule[]
    | { rules: SigningAuthorityRule[] };
  return Array.isArray(data) ? data : data.rules;
}

export type ResolvedSigningFlow = {
  ready: boolean;
  /** Lý do không khớp — backend trả sẵn câu tiếng Việt. */
  reason: string | null;
  bandLabel: string;
  /** Recipients phía công ty (isMyOrg) — chưa merge với đối tác. */
  recipients: SignRecipient[];
};

/**
 * Hỏi backend xem tổ hợp (Công ty × Loại HĐ × Giá trị) rơi vào dòng nào của
 * bảng phân quyền ký.
 *
 * Việc khớp dải giá trị phải ở server: bảng quy tắc là dữ liệu của IT/Legal và
 * backend còn dùng chính kết quả này khi đẩy eContract. Tính lại ở client chỉ
 * tạo ra hai nguồn sự thật lệch nhau.
 */
export async function previewSigningFlow(input: {
  documentCategoryId: string;
  contractValue: string | number;
  businessEntityId?: string | null;
}): Promise<ResolvedSigningFlow> {
  return api.post("/api/v1/signing-rules/preview", {
    documentCategoryId: input.documentCategoryId,
    businessEntityId: input.businessEntityId ?? null,
    contractValue: input.contractValue,
  }) as Promise<ResolvedSigningFlow>;
}

/** Kiểm tra review đã có quy tắc ký khớp (trước đẩy eContract). */
export async function assertSigningMatrixReady(review: {
  intake?: {
    documentCategoryId?: string;
    contractValue?: string;
    businessEntityId?: string;
  } | null;
}): Promise<void> {
  const parentId = review.intake?.documentCategoryId;
  const value = review.intake?.contractValue;
  if (!parentId) {
    throw new Error("Thiếu Loại HĐ — không đẩy được eContract");
  }
  if (value == null || String(value).trim() === "") {
    throw new Error("Thiếu Giá trị HĐ — không đẩy được eContract");
  }
  const flow = await previewSigningFlow({
    documentCategoryId: parentId,
    contractValue: value,
    businessEntityId: review.intake?.businessEntityId,
  });
  if (!flow.ready) {
    throw new Error(
      flow.reason ||
        "Chưa có dòng phân quyền ký khớp Công ty / Loại HĐ / Giá trị — vào Configurations → Phân quyền ký"
    );
  }
}

/**
 * Merge recipients từ ma trận (isMyOrg) vào list hiện tại — giữ đối tác / marker st.
 */

export function lifecycleBadgeVariant(
  lifecycle: ContractTypeConfigVersion["lifecycle"]
): "default" | "secondary" | "outline" {
  if (lifecycle === "published") return "default";
  if (lifecycle === "draft") return "secondary";
  return "outline";
}

export function clauseKindLabel(kind: ChecklistClause["kind"]) {
  if (kind === "required") return "Bắt buộc";
  if (kind === "forbidden") return "Cấm";
  return "Khuyến nghị";
}

export function severityLabel(s: ChecklistClause["severity"]) {
  if (s === "block") return "Block";
  if (s === "warn_high") return "Cảnh báo cao";
  return "Cảnh báo thấp";
}

// silence unused type import if tree-shaken oddly
export type { ConfigAuditAction };
