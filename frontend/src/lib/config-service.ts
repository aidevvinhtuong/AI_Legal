import { USE_MOCK } from "@/lib/api";
import {
  DEFAULT_CONFIG_PERMISSIONS,
  type ChecklistClause,
  type ConfigAuditAction,
  type ConfigAuditEntry,
  type ConfigPermission,
  type ContractParentCategory,
  type ContractTypeConfigVersion,
  type ApprovalMatrixConfig,
} from "@/lib/config-types";
import {
  loadConfigAudit,
  loadConfigVersions,
  loadMatrices,
  loadParentCategories,
  saveConfigAudit,
  saveConfigVersions,
  saveParentCategories,
} from "@/lib/config-mock";
import { getSession } from "@/lib/review-service";
import type { ContractGroup, UserRole } from "@/lib/types";

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
  throw new Error("API chưa sẵn sàng");
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
  throw new Error("API chưa sẵn sàng");
}

export async function listMatrices(): Promise<ApprovalMatrixConfig[]> {
  if (USE_MOCK) {
    await delay(100);
    return loadMatrices();
  }
  throw new Error("API chưa sẵn sàng");
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
  throw new Error("API chưa sẵn sàng");
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
  throw new Error("API chưa sẵn sàng");
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

function slugifyLabel(label: string, max = 40): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max);
}

export async function listParentCategories(): Promise<ContractParentCategory[]> {
  if (USE_MOCK) {
    await delay(80);
    return loadParentCategories();
  }
  throw new Error("API chưa sẵn sàng");
}

/**
 * Tạo loại hợp đồng cha mới (nhóm chứa nhiều loại con).
 */
export async function createParentContractCategory(input: {
  label: string;
  description?: string;
  group?: ContractGroup;
}): Promise<ContractParentCategory> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền tạo loại hợp đồng");

  const trimmed = input.label.trim();
  if (!trimmed) throw new Error("Nhập tên loại hợp đồng cha");

  const base = slugifyLabel(trimmed, 28) || "parent";
  const id = `${base}_${Date.now().toString(36).slice(-4)}`;
  const group: ContractGroup =
    input.group || (base.includes("vendor") || base.includes("ncc") ? "vendor" : "framework");

  const parent: ContractParentCategory = {
    id,
    label: trimmed,
    description: input.description?.trim() || undefined,
    group,
  };

  if (USE_MOCK) {
    await delay();
    const list = loadParentCategories();
    if (list.some((p) => p.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error("Đã có loại hợp đồng cha cùng tên");
    }
    list.push(parent);
    saveParentCategories(list);
    return parent;
  }
  throw new Error("API chưa sẵn sàng");
}

/**
 * Tạo loại hợp đồng con (line) mới dưới một loại cha.
 * Mỗi line = một contractTypeId riêng (bản v1 trống checklist, sửa trực tiếp).
 */
export async function createChildContractType(
  parentCategoryId: string,
  label: string
): Promise<ContractTypeConfigVersion> {
  const perm = getConfigPermission();
  if (!perm.canEditDraft) throw new Error("Không có quyền tạo loại con");

  const parents = loadParentCategories();
  const parent = parents.find((p) => p.id === parentCategoryId);
  if (!parent) throw new Error("Không tìm thấy loại hợp đồng cha");

  const trimmed = label.trim();
  if (!trimmed) throw new Error("Nhập tên loại hợp đồng con");

  const slug = slugifyLabel(trimmed);
  const contractTypeId = `${parentCategoryId}_${slug || "child"}_${Date.now()
    .toString(36)
    .slice(-4)}`;

  const a = actor();
  const group: ContractGroup =
    parent.group || (parentCategoryId === "vendor" ? "vendor" : "framework");
  const child: ContractTypeConfigVersion = {
    id: `cfg_${contractTypeId}_v1`,
    contractTypeId,
    parentCategoryId,
    label: trimmed,
    group,
    lifecycle: "published",
    version: 1,
    requireTemplateMatch: group === "framework",
    clauses: [],
    approvalMatrixId: null,
    aiTiers: {
      ruleBasedEnabled: true,
      semanticEnabled: true,
      notes: `Loại con mới dưới ${parent.label}`,
    },
    createdAt: now(),
    updatedAt: now(),
    createdBy: a.name,
    updatedBy: a.name,
  };

  if (USE_MOCK) {
    await delay();
    const list = loadConfigVersions();
    list.unshift(child);
    saveConfigVersions(list);
    appendAudit({
      configVersionId: child.id,
      contractTypeId: child.contractTypeId,
      action: "create_draft",
      note: `Thêm loại con dưới ${parent.label}: ${trimmed}`,
    });
    return child;
  }
  throw new Error("API chưa sẵn sàng");
}

/** Một line hiển thị trên list: bản active mới nhất (không archive). */
export function pickChildLineConfig(
  versions: ContractTypeConfigVersion[]
): ContractTypeConfigVersion | null {
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return (
    sorted.find((v) => v.lifecycle !== "archived") ||
    sorted[0]
  );
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
