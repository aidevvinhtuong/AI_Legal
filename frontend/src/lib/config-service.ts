import { api, USE_MOCK } from "@/lib/api";
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
  type SigningSlotRole,
} from "@/lib/config-types";
import {
  loadConfigAudit,
  loadConfigVersions,
  loadMatrices,
  loadSigningRules,
  saveConfigAudit,
  saveConfigVersions,
  saveSigningRules as persistSigningRules,
} from "@/lib/config-mock";
import {
  loadFormLists,
  saveFormLists,
  type ContractNameOption,
} from "@/lib/form-lists-store";
import { loadReviews } from "@/lib/mock-data";
import { getSession } from "@/lib/review-service";
import { getUserById } from "@/lib/user-store";
import type {
  ContractGroup,
  DocumentCategory,
  EcontractSignType,
  MarkerType,
  SignRecipient,
  UserRole,
} from "@/lib/types";

function markerTypeForSignType(signType: EcontractSignType): MarkerType | null {
  if (signType === "review") return null;
  if (signType === "sign_img") return "is";
  return "ds";
}

function delay(ms = 250) {
  return new Promise((r) => setTimeout(r, ms));
}

function now() {
  return new Date().toISOString();
}

function actor() {
  const s = getSession();
  return {
    name: s?.name || "Unknown",
    role: s?.role || "legal",
  };
}

export function getConfigPermission(role?: UserRole): ConfigPermission {
  const session = getSession();
  const r = role || session?.role || "purchasing";
  const perms = session?.permissions;
  // Ưu tiên tick permissions trên user (IT gán)
  if (perms?.length) {
    const canConfig = perms.includes("contract_config");
    return {
      role: r === "it" ? "it" : r === "legal_lead" ? "legal_lead" : r === "legal" ? "legal" : "purchasing",
      canView: canConfig,
      canEditDraft: canConfig,
      canImportExport: canConfig,
      canViewAudit: canConfig || r === "it",
    };
  }
  const mapped =
    r === "it"
      ? "it"
      : r === "legal_lead"
        ? "legal_lead"
        : r === "legal"
          ? "legal"
          : "purchasing";
  return (
    DEFAULT_CONFIG_PERMISSIONS.find((p) => p.role === mapped) ||
    DEFAULT_CONFIG_PERMISSIONS[2]
  );
}

function assertCanEditConfig(cfg: ContractTypeConfigVersion) {
  if (cfg.lifecycle === "archived") {
    throw new Error("Bản đã archive — không sửa được");
  }
}

function appendAudit(
  entry: Omit<ConfigAuditEntry, "id" | "at" | "actorName" | "actorRole"> & {
    note?: string;
  }
) {
  const a = actor();
  const list = loadConfigAudit();
  list.unshift({
    ...entry,
    id: `aud_${Date.now()}`,
    at: now(),
    actorName: a.name,
    actorRole: a.role,
  });
  saveConfigAudit(list.slice(0, 200));
}

export async function listConfigVersions(): Promise<ContractTypeConfigVersion[]> {
  if (USE_MOCK) {
    await delay();
    return loadConfigVersions().sort(
      (a, b) =>
        a.contractTypeId.localeCompare(b.contractTypeId) || b.version - a.version
    );
  }
  return api.get("/api/config/versions") as Promise<ContractTypeConfigVersion[]>;
}

export async function getConfigVersion(
  id: string
): Promise<ContractTypeConfigVersion> {
  if (USE_MOCK) {
    await delay();
    const found = loadConfigVersions().find((c) => c.id === id);
    if (!found) throw new Error("Không tìm thấy cấu hình");
    return found;
  }
  return api.get(`/api/config/versions/${id}`) as Promise<ContractTypeConfigVersion>;
}

export async function listMatrices(): Promise<ApprovalMatrixConfig[]> {
  if (USE_MOCK) {
    await delay(100);
    return loadMatrices();
  }
  return api.get("/api/config/matrices") as Promise<ApprovalMatrixConfig[]>;
}

export async function listConfigAudit(
  contractTypeId?: string
): Promise<ConfigAuditEntry[]> {
  if (USE_MOCK) {
    await delay(100);
    const all = loadConfigAudit();
    return contractTypeId
      ? all.filter((a) => a.contractTypeId === contractTypeId)
      : all;
  }
  const q = contractTypeId
    ? `?contractTypeId=${encodeURIComponent(contractTypeId)}`
    : "";
  return api.get(`/api/config/audit${q}`) as Promise<ConfigAuditEntry[]>;
}

export async function saveConfigDraft(
  config: ContractTypeConfigVersion
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền sửa cấu hình");
  assertCanEditConfig(config);

  if (USE_MOCK) {
    await delay();
    const a = actor();
    const updated: ContractTypeConfigVersion = {
      ...config,
      updatedAt: now(),
      updatedBy: a.name,
    };
    const list = loadConfigVersions();
    const idx = list.findIndex((c) => c.id === config.id);
    if (idx >= 0) list[idx] = updated;
    else list.unshift(updated);
    saveConfigVersions(list);
    appendAudit({
      configVersionId: updated.id,
      contractTypeId: updated.contractTypeId,
      action: "update_meta",
      note: `Lưu v${updated.version}`,
    });
    return updated;
  }
  return api.put(`/api/config/versions/${config.id}`, config) as Promise<ContractTypeConfigVersion>;
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
  appendAudit({
    configVersionId: configId,
    contractTypeId: cfg.contractTypeId,
    action: isNew ? "add_clause" : "update_clause",
    clauseCode: clause.code,
    newValue: clause.name,
  });
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
  appendAudit({
    configVersionId: configId,
    contractTypeId: cfg.contractTypeId,
    action: "remove_clause",
    clauseCode: removed?.code,
    oldValue: removed?.name,
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
  appendAudit({
    configVersionId: configId,
    contractTypeId: cfg.contractTypeId,
    action: "link_matrix",
    field: "approvalMatrixId",
    oldValue: old || "global",
    newValue: matrixId || "global",
  });
  return updated;
}

export async function runTestPreview(
  configId: string,
  sampleFileName: string
): Promise<ContractTypeConfigVersion> {
  const cfg = await getConfigVersion(configId);
  assertCanEditConfig(cfg);
  await delay(800);
  const a = actor();
  const active = cfg.clauses.filter((c) => c.active);
  const failCount = Math.min(
    1,
    active.filter((c) => c.kind === "forbidden" && c.severity === "block").length
      ? 0
      : 0
  );
  const warnCount = active.filter((c) => c.kind === "recommended").length;
  const passCount = Math.max(0, active.length - failCount - warnCount);
  const updated = await saveConfigDraft({
    ...cfg,
    lastTestPreview: {
      sampleFileName,
      testedAt: now(),
      testedBy: a.name,
      summary: `${passCount} pass · ${failCount} fail · ${warnCount} warn`,
      passCount,
      failCount,
      warnCount,
    },
  });
  appendAudit({
    configVersionId: configId,
    contractTypeId: cfg.contractTypeId,
    action: "test_preview",
    note: `Test trên ${sampleFileName}: ${updated.lastTestPreview?.summary}`,
  });
  return updated;
}

/**
 * Loại hợp đồng cha = Form lists → Loại hợp đồng (documentCategories).
 * Không tạo loại cha riêng trên màn Cấu hình HĐ.
 */
export async function listParentCategories(): Promise<ContractParentCategory[]> {
  if (USE_MOCK) {
    await delay(80);
    const cats = loadFormLists().documentCategories.filter(
      (c: DocumentCategory) => c.status !== "archived"
    );
    return cats.map((c: DocumentCategory) => ({
      id: c.id,
      label: c.label?.includes(c.code) ? c.label : `${c.code} — ${c.label}`,
      description: `Loại hợp đồng Form lists (mã ${c.code})`,
      group: "framework" as ContractGroup,
    }));
  }
  return api.get("/api/config/parent-categories") as Promise<
    ContractParentCategory[]
  >;
}

/** Tên hợp đồng con = Form lists → contractNames (link documentCategoryId). Chỉ active. */
export async function listFormListContractNames(
  categoryId?: string
): Promise<ContractNameOption[]> {
  if (USE_MOCK) {
    await delay(50);
    const names = loadFormLists().contractNames.filter(
      (n) => n.status !== "archived"
    );
    if (!categoryId) return names;
    return names.filter((n) => n.documentCategoryId === categoryId);
  }
  const q = categoryId
    ? `?categoryId=${encodeURIComponent(categoryId)}`
    : "";
  return api.get(`/api/config/contract-names${q}`) as Promise<ContractNameOption[]>;
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

export function findConfigByBusinessKey(
  contractTypeId: string,
  opts?: { includeArchived?: boolean }
): ContractTypeConfigVersion | null {
  const versions = loadConfigVersions().filter(
    (c) => c.contractTypeId === contractTypeId
  );
  return pickChildLineConfig(versions, opts);
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

/** Resolve checklist AI theo Tên hợp đồng (intake.contractNameId). */
export function getMergedConfigForContractName(
  contractNameId: string
): MergedContractConfig {
  const lists = loadFormLists();
  const name = lists.contractNames.find((n) => n.id === contractNameId);
  const parentId = name?.documentCategoryId;
  const parent = parentId
    ? findConfigByBusinessKey(parentId)
    : null;
  const child = findConfigByBusinessKey(contractNameId);
  return mergeParentAndChildConfig(parent, child);
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

  const lists = loadFormLists();
  const cat = lists.documentCategories.find((c) => c.id === categoryId);
  if (!cat) {
    throw new Error(
      "Loại hợp đồng không có trong Form lists — thêm tại Configurations → Form lists"
    );
  }

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const versions = list.filter((c) => c.contractTypeId === categoryId);
    const existing = pickChildLineConfig(versions, { includeArchived: true });
    if (existing && existing.lifecycle !== "archived") {
      if (!existing.configLayer) {
        const patched = { ...existing, configLayer: "parent" as const };
        const idx = list.findIndex((c) => c.id === existing.id);
        if (idx >= 0) {
          list[idx] = patched;
          saveConfigVersions(list);
        }
        return patched;
      }
      return existing;
    }
    if (existing?.lifecycle === "archived") {
      throw new Error("Checklist loại cha đã lưu trữ — khôi phục trước khi mở sửa");
    }

    if (!perm.canEditDraft) {
      throw new Error("Chưa có checklist loại cha — cần quyền cấu hình để tạo bản đầu");
    }

    const a = actor();
    const group = categoryGroup(categoryId);
    const parent: ContractTypeConfigVersion = {
      id: `cfg_parent_${categoryId}_v1`,
      contractTypeId: categoryId,
      parentCategoryId: categoryId,
      configLayer: "parent",
      label: cat.label?.includes(cat.code) ? cat.label : `${cat.label} (${cat.code})`,
      group,
      lifecycle: "published",
      version: 1,
      requireTemplateMatch: group === "framework",
      clauses: [],
      approvalMatrixId: null,
      aiTiers: {
        ruleBasedEnabled: true,
        semanticEnabled: true,
        notes: `Checklist chung Loại HĐ ${cat.code} — mọi Tên HĐ con kế thừa.`,
      },
      createdAt: now(),
      updatedAt: now(),
      createdBy: a.name,
      updatedBy: a.name,
    };
    list.unshift(parent);
    saveConfigVersions(list);
    appendAudit({
      configVersionId: parent.id,
      contractTypeId: parent.contractTypeId,
      action: "create_draft",
      note: `Khởi tạo checklist loại cha Form lists: ${cat.label}`,
    });
    return parent;
  }
  return api.post(`/api/config/parent-categories/${categoryId}/ensure`, {}) as Promise<ContractTypeConfigVersion>;
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

  const lists = loadFormLists();
  const name = lists.contractNames.find((n) => n.id === contractNameId);
  if (!name) {
    throw new Error(
      "Tên hợp đồng không có trong Form lists — thêm tại Configurations → Form lists"
    );
  }

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const versions = list.filter((c) => c.contractTypeId === contractNameId);
    const existing = pickChildLineConfig(versions, { includeArchived: true });
    if (existing && existing.lifecycle !== "archived") {
      if (!existing.configLayer) {
        const patched = { ...existing, configLayer: "child" as const };
        const idx = list.findIndex((c) => c.id === existing.id);
        if (idx >= 0) {
          list[idx] = patched;
          saveConfigVersions(list);
        }
        return patched;
      }
      return existing;
    }
    if (existing?.lifecycle === "archived") {
      throw new Error("Checklist riêng đã lưu trữ — khôi phục trước khi mở sửa");
    }

    if (!perm.canEditDraft) {
      throw new Error("Chưa có checklist riêng — cần quyền cấu hình để tạo bản đầu");
    }

    const a = actor();
    const group = categoryGroup(name.documentCategoryId);
    const child: ContractTypeConfigVersion = {
      id: `cfg_${contractNameId}_v1`,
      contractTypeId: contractNameId,
      parentCategoryId: name.documentCategoryId,
      configLayer: "child",
      label: name.label,
      group,
      lifecycle: "published",
      version: 1,
      requireTemplateMatch: group === "framework",
      clauses: [],
      approvalMatrixId: null,
      aiTiers: {
        ruleBasedEnabled: true,
        semanticEnabled: true,
        notes: `Overlay riêng Tên HĐ: ${name.label} — gộp với checklist loại cha ${name.documentCategoryId}.`,
      },
      createdAt: now(),
      updatedAt: now(),
      createdBy: a.name,
      updatedBy: a.name,
    };
    list.unshift(child);
    saveConfigVersions(list);
    appendAudit({
      configVersionId: child.id,
      contractTypeId: child.contractTypeId,
      action: "create_draft",
      note: `Khởi tạo overlay checklist con: ${name.label}`,
    });
    return child;
  }
  return api.post(`/api/config/contract-names/${contractNameId}/ensure`, {}) as Promise<ContractTypeConfigVersion>;
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
 * Số HĐ đang tham chiếu Tên hợp đồng (contractNames.id)
 * hoặc contractTypeId legacy trên review.
 */
export function countReviewsUsingContractType(contractTypeId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return loadReviews().filter(
      (r) =>
        r.intake?.contractNameId === contractTypeId ||
        r.contractTypeId === contractTypeId
    ).length;
  } catch {
    return 0;
  }
}

/** Số HĐ thuộc loại cha (qua documentCategoryId hoặc tên con). */
export function countReviewsUsingParentCategory(categoryId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const childIds = new Set(
      loadFormLists()
        .contractNames.filter((n) => n.documentCategoryId === categoryId)
        .map((n) => n.id)
    );
    return loadReviews().filter(
      (r) =>
        r.intake?.documentCategoryId === categoryId ||
        (!!r.intake?.contractNameId && childIds.has(r.intake.contractNameId))
    ).length;
  } catch {
    return 0;
  }
}

/** Đồng bộ status Form lists → Tên hợp đồng (ẩn khỏi form tạo khi archived). */
function syncFormListContractNameStatus(
  contractNameId: string,
  status: "active" | "archived"
) {
  const lists = loadFormLists();
  const idx = lists.contractNames.findIndex((t) => t.id === contractNameId);
  if (idx < 0) return;
  lists.contractNames[idx] = {
    ...lists.contractNames[idx],
    status,
  };
  saveFormLists(lists);
}

async function archiveConfigByKey(
  contractTypeId: string,
  note: string
): Promise<void> {
  const list = loadConfigVersions();
  const matched = list.filter((c) => c.contractTypeId === contractTypeId);
  const a = actor();
  if (matched.some((c) => c.lifecycle !== "archived")) {
    const next = list.map((c) =>
      c.contractTypeId === contractTypeId && c.lifecycle !== "archived"
        ? {
            ...c,
            lifecycle: "archived" as const,
            updatedAt: now(),
            updatedBy: a.name,
          }
        : c
    );
    saveConfigVersions(next);
  }
  appendAudit({
    configVersionId: matched[0]?.id || `cfg_${contractTypeId}`,
    contractTypeId,
    action: "archive",
    note,
  });
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

  if (USE_MOCK) {
    await delay();
    const name = loadFormLists().contractNames.find(
      (n) => n.id === contractTypeId
    );
    if (!name) {
      throw new Error("Không tìm thấy Tên hợp đồng trong Form lists");
    }
    if (name.status === "archived") {
      throw new Error("Tên hợp đồng đã được lưu trữ");
    }

    const matched = loadConfigVersions().filter(
      (c) => c.contractTypeId === contractTypeId
    );
    const usage = countReviewsUsingContractType(contractTypeId);
    if (matched.some((c) => c.lifecycle !== "archived")) {
      await archiveConfigByKey(
        contractTypeId,
        usage > 0
          ? `Lưu trữ overlay Tên HĐ (đang dùng bởi ${usage} HĐ)`
          : `Lưu trữ overlay Tên HĐ Form lists: ${name.label}`
      );
    } else {
      appendAudit({
        configVersionId: matched[0]?.id || `cfg_${contractTypeId}`,
        contractTypeId,
        action: "archive",
        note: `Lưu trữ Tên hợp đồng Form lists (không có overlay): ${name.label}`,
      });
    }
    syncFormListContractNameStatus(contractTypeId, "archived");
    return;
  }
  await api.post(`/api/config/contract-types/${contractTypeId}/archive`, {});
}

/** Lưu trữ checklist loại cha — các con vẫn hiện; AI chỉ còn overlay con (nếu có). */
export async function archiveParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền lưu trữ cấu hình loại cha");

  if (USE_MOCK) {
    await delay();
    const cat = loadFormLists().documentCategories.find((c) => c.id === categoryId);
    if (!cat) throw new Error("Không tìm thấy Loại hợp đồng trong Form lists");
    const matched = loadConfigVersions().filter(
      (c) => c.contractTypeId === categoryId
    );
    if (!matched.some((c) => c.lifecycle !== "archived")) {
      throw new Error("Checklist loại cha chưa có hoặc đã lưu trữ");
    }
    const usage = countReviewsUsingParentCategory(categoryId);
    await archiveConfigByKey(
      categoryId,
      usage > 0
        ? `Lưu trữ checklist loại cha ${cat.code} (${usage} HĐ thuộc loại — con vẫn kế thừa khi khôi phục)`
        : `Lưu trữ checklist loại cha: ${cat.label}`
    );
    return;
  }
  await api.post(`/api/config/parent-categories/${categoryId}/archive`, {});
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

  const usage = countReviewsUsingContractType(contractTypeId);
  if (usage > 0) {
    throw new Error(
      `Tên hợp đồng đang được dùng bởi ${usage} HĐ — chỉ được Lưu trữ, không xóa checklist riêng.`
    );
  }

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const matched = list.filter((c) => c.contractTypeId === contractTypeId);
    if (!matched.length) throw new Error("Chưa có checklist riêng để xóa");
    saveConfigVersions(
      list.filter((c) => c.contractTypeId !== contractTypeId)
    );
    syncFormListContractNameStatus(contractTypeId, "active");
    appendAudit({
      configVersionId: matched[0].id,
      contractTypeId,
      action: "delete",
      note: `Xóa overlay checklist: ${matched[0].label} (vẫn kế thừa loại cha)`,
    });
    return;
  }
  await api.delete(`/api/config/contract-types/${contractTypeId}`);
  return;
}

/** Xóa checklist loại cha — chặn nếu có HĐ thuộc loại. */
export async function deleteParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền xóa cấu hình loại cha");

  const usage = countReviewsUsingParentCategory(categoryId);
  if (usage > 0) {
    throw new Error(
      `Loại HĐ đang có ${usage} HĐ — chỉ được Lưu trữ checklist loại cha, không xóa.`
    );
  }

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const matched = list.filter((c) => c.contractTypeId === categoryId);
    if (!matched.length) throw new Error("Chưa có checklist loại cha để xóa");
    saveConfigVersions(list.filter((c) => c.contractTypeId !== categoryId));
    appendAudit({
      configVersionId: matched[0].id,
      contractTypeId: categoryId,
      action: "delete",
      note: `Xóa checklist loại cha: ${matched[0].label}`,
    });
    return;
  }
  await api.delete(`/api/config/parent-categories/${categoryId}`);
  return;
}

/** Khôi phục Tên hợp đồng đã lưu trữ → overlay + hiện lại trên form tạo HĐ. */
export async function restoreChildContractType(
  contractTypeId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền khôi phục loại hợp đồng");

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const matched = list.filter((c) => c.contractTypeId === contractTypeId);
    const a = actor();

    if (matched.length) {
      const archived = matched.filter((c) => c.lifecycle === "archived");
      if (archived.length) {
        const latest = [...archived].sort((x, y) => y.version - x.version)[0];
        const next = list.map((c) =>
          c.id === latest.id
            ? {
                ...c,
                lifecycle: "published" as const,
                updatedAt: now(),
                updatedBy: a.name,
              }
            : c
        );
        saveConfigVersions(next);
        appendAudit({
          configVersionId: latest.id,
          contractTypeId,
          action: "restore",
          note: `Khôi phục overlay checklist v${latest.version}`,
        });
      }
    }
    syncFormListContractNameStatus(contractTypeId, "active");
    return;
  }
  await api.post(`/api/config/contract-types/${contractTypeId}/restore`, {});
  return;
}

/** Khôi phục checklist loại cha đã lưu trữ. */
export async function restoreParentContractConfig(
  categoryId: string
): Promise<void> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền khôi phục cấu hình loại cha");

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    const matched = list.filter((c) => c.contractTypeId === categoryId);
    const archived = matched.filter((c) => c.lifecycle === "archived");
    if (!archived.length) throw new Error("Không có checklist loại cha đã lưu trữ");
    const a = actor();
    const latest = [...archived].sort((x, y) => y.version - x.version)[0];
    const next = list.map((c) =>
      c.id === latest.id
        ? {
            ...c,
            lifecycle: "published" as const,
            updatedAt: now(),
            updatedBy: a.name,
          }
        : c
    );
    saveConfigVersions(next);
    appendAudit({
      configVersionId: latest.id,
      contractTypeId: categoryId,
      action: "restore",
      note: `Khôi phục checklist loại cha v${latest.version}`,
    });
    return;
  }
  await api.post(`/api/config/parent-categories/${categoryId}/restore`, {});
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

  appendAudit({
    configVersionId: config.id,
    contractTypeId: config.contractTypeId,
    action: "export_excel",
    note: `Export ${config.clauses.length} clauses`,
  });

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
  appendAudit({
    configVersionId: configId,
    contractTypeId: cfg.contractTypeId,
    action: "import_excel",
    note: `Import ${imported.length} dòng CSV`,
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
  if (USE_MOCK) {
    await delay(80);
    return loadSigningRules();
  }
  return api.get("/api/signing-rules") as Promise<SigningAuthorityRule[]>;
}

function parseContractValueVnd(raw: string | number | null | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw == null) return NaN;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return NaN;
  return Number(digits);
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

  if (USE_MOCK) {
    await delay();
    const a = actor();
    const next = rules.map((r, i) => ({
      ...r,
      order: r.order || i + 1,
      signType:
        r.ecRole === "reviewer"
          ? ("review" as const)
          : r.signType && r.signType !== "review"
            ? r.signType
            : ("sign_fca.passcode" as const),
    }));
    persistSigningRules(next);
    appendAudit({
      configVersionId: "signing_rules",
      contractTypeId: "signing_rules",
      action: "save_signing_matrix",
      note: `Lưu bảng phân quyền ký ${next.length} dòng (bởi ${a.name})`,
    });
    return next;
  }
  const data = (await api.put("/api/signing-rules", { rules })) as
    | SigningAuthorityRule[]
    | { rules: SigningAuthorityRule[] };
  return Array.isArray(data) ? data : data.rules;
}

export type ResolvedSigningFlow = {
  rules: SigningAuthorityRule[];
  bandLabel: string;
  /** Recipients phía công ty (isMyOrg) — chưa merge với đối tác. */
  companyRecipients: SignRecipient[];
};

function ruleToRecipient(
  rule: SigningAuthorityRule,
  index: number,
  bandLabel: string,
  orgName: string
): SignRecipient {
  const isReviewer = rule.ecRole === "reviewer";
  const signType = isReviewer
    ? "review"
    : rule.signType || "sign_fca.passcode";
  const mt = markerTypeForSignType(signType);
  const markerType: MarkerType = mt || "ds";
  const seq = String(index + 1).padStart(3, "0");
  const user = getUserById(rule.userId);
  const contactId = user?.username?.trim() || rule.userId || "";
  return {
    id: `p_001_r_${seq}`,
    name: rule.personalName,
    role: "company",
    partyId: "p_001",
    orgName,
    isMyOrg: true,
    order: rule.order || index + 1,
    email: rule.email,
    phone: rule.telephoneNumber || "",
    userId: rule.userId,
    contactId,
    ecRole: isReviewer ? "reviewer" : "signer",
    signType,
    markerType,
    notifyTypes: ["email_econtract", "sms_econtract"],
    signingMatrixBandLabel: bandLabel,
  };
}

function ruleMatchesValue(rule: SigningAuthorityRule, value: number): boolean {
  if (value < rule.minValue) return false;
  if (rule.maxValue != null && value > rule.maxValue) return false;
  return true;
}

/**
 * Resolve bảng quy tắc → recipients phía công ty.
 * Khớp: Công ty (nếu có) + Loại HĐ + giá trị trong [min, max].
 */
export function resolveSigningRecipients(
  documentCategoryId: string,
  contractValue: string | number,
  orgName = "Công ty SGVN",
  businessEntityId?: string | null
): ResolvedSigningFlow {
  const value = parseContractValueVnd(contractValue);
  if (!Number.isFinite(value)) {
    throw new Error(
      "Giá trị hợp đồng không hợp lệ — không chọn được dòng ma trận ký"
    );
  }

  const matched = loadSigningRules()
    .filter((r) => r.documentCategoryId === documentCategoryId)
    .filter((r) => {
      if (!businessEntityId) return true;
      return r.businessEntityIds.includes(businessEntityId);
    })
    .filter((r) => ruleMatchesValue(r, value))
    .sort((a, b) => {
      const roleRank = (x: SigningSlotRole) => (x === "reviewer" ? 0 : 1);
      return roleRank(a.ecRole) - roleRank(b.ecRole) || a.order - b.order;
    });

  if (!matched.length) {
    throw new Error(
      "Chưa có dòng phân quyền ký khớp Công ty / Loại HĐ / Giá trị — vào Configurations → Phân quyền ký"
    );
  }

  const hasSigner = matched.some((r) => r.ecRole === "signer");
  if (!hasSigner) {
    throw new Error(
      "Ma trận khớp điều kiện nhưng thiếu người Ký chính (signer)"
    );
  }

  const bandLabel =
    matched[0].maxValue == null
      ? `≥ ${matched[0].minValue.toLocaleString("vi-VN")}`
      : `${matched[0].minValue.toLocaleString("vi-VN")} – ${matched[0].maxValue.toLocaleString("vi-VN")}`;

  // Deduplicate same user+role
  const seen = new Set<string>();
  const unique = matched.filter((r) => {
    const key = `${r.ecRole}:${r.userId || r.email}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const companyRecipients = unique.map((r, i) =>
    ruleToRecipient(r, i, bandLabel, orgName)
  );

  return { rules: unique, bandLabel, companyRecipients };
}

/** Kiểm tra review đã có quy tắc ký khớp (trước đẩy eContract). */
export function assertSigningMatrixReady(review: {
  intake?: {
    documentCategoryId?: string;
    contractValue?: string;
    businessEntityId?: string;
  } | null;
}): void {
  const parentId = review.intake?.documentCategoryId;
  const value = review.intake?.contractValue;
  if (!parentId) {
    throw new Error("Thiếu Loại HĐ — không đẩy được eContract");
  }
  if (value == null || String(value).trim() === "") {
    throw new Error("Thiếu Giá trị HĐ — không đẩy được eContract");
  }
  resolveSigningRecipients(
    parentId,
    value,
    "Công ty SGVN",
    review.intake?.businessEntityId
  );
}

/**
 * Merge recipients từ ma trận (isMyOrg) vào list hiện tại — giữ đối tác / marker st.
 */
export function mergeCompanyRecipientsFromMatrix(
  existing: SignRecipient[],
  companyRecipients: SignRecipient[]
): SignRecipient[] {
  const keep = existing.filter((r) => {
    if (r.markerType === "st") return true;
    const isCompany =
      r.isMyOrg === true || (r.isMyOrg == null && r.role === "company");
    return !isCompany;
  });
  return [...companyRecipients, ...keep];
}

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
