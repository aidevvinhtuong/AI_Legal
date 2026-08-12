/**
 * Phương thức 2 — validate re-uploaded .docx before starting a NEW AI review cycle.
 * Buffer-based (safe for browser + Node). Path-based helper lives in reupload-validation-node.ts.
 */

import {
  analyzeDocxContentControls,
  type DocxContentControl,
  type DocxFieldInventory,
} from "./docx-content-controls";

export interface FieldStructureIssue {
  type: "missing_field" | "locked_region_modified" | "unexpected_new_field";
  fieldId?: string;
  location?: string;
  diffPreview?: string;
}

export interface ReuploadValidationResult {
  isValid: boolean;
  issues: FieldStructureIssue[];
  newVersionNumber?: number;
}

export class ReuploadValidationError extends Error {
  issues: FieldStructureIssue[];

  constructor(issues: FieldStructureIssue[]) {
    super(
      issues.length
        ? `Cấu trúc file không hợp lệ (${issues.length} lỗi)`
        : "Cấu trúc file không hợp lệ"
    );
    this.name = "ReuploadValidationError";
    this.issues = issues;
  }
}

function byTag(list: DocxContentControl[]): Map<string, DocxContentControl> {
  const map = new Map<string, DocxContentControl>();
  for (const c of list) {
    if (!map.has(c.tag)) map.set(c.tag, c);
  }
  return map;
}

function previewDiff(before: string, after: string, max = 80): string {
  const a = (before || "").slice(0, max);
  const b = (after || "").slice(0, max);
  return `Trước: “${a || "(trống)"}” → Sau: “${b || "(trống)"}”`;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function compareDocxStructures(args: {
  template: DocxFieldInventory;
  previous: DocxFieldInventory;
  newly: DocxFieldInventory;
  previousLockedFingerprint?: string;
  newlyLockedFingerprint?: string;
}): FieldStructureIssue[] {
  const { template, previous, newly } = args;
  const issues: FieldStructureIssue[] = [];

  const templateMap = byTag(template.contentControls);
  const prevMap = byTag(previous.contentControls);
  const newMap = byTag(newly.contentControls);

  const expectedTags = new Set<string>([
    ...templateMap.keys(),
    ...prevMap.keys(),
  ]);
  const SYNTHETIC = "doc_body_locked";

  for (const tag of expectedTags) {
    if (tag === SYNTHETIC) continue;
    const expected = templateMap.get(tag) || prevMap.get(tag)!;
    const found = newMap.get(tag);
    if (!found) {
      issues.push({
        type: "missing_field",
        fieldId: tag,
        location: expected.alias || tag,
      });
      continue;
    }
    if (expected.locked || found.locked) {
      const before = normalizeText(
        (templateMap.get(tag) || prevMap.get(tag))?.value || ""
      );
      const after = normalizeText(found.value || "");
      if (before && after !== before && (expected.locked || found.locked)) {
        issues.push({
          type: "locked_region_modified",
          fieldId: tag,
          location: found.alias || expected.alias || tag,
          diffPreview: previewDiff(before, after),
        });
      }
    }
  }

  for (const [tag, ctrl] of newMap) {
    if (tag === SYNTHETIC) continue;
    if (!expectedTags.has(tag) && !prevMap.has(tag) && !templateMap.has(tag)) {
      if (template.hasStructuredFields || previous.hasStructuredFields) {
        issues.push({
          type: "unexpected_new_field",
          fieldId: tag,
          location: ctrl.alias || tag,
        });
      }
    }
  }

  if (
    args.previousLockedFingerprint != null &&
    args.newlyLockedFingerprint != null &&
    args.previousLockedFingerprint.length > 0 &&
    args.previousLockedFingerprint !== args.newlyLockedFingerprint
  ) {
    issues.push({
      type: "locked_region_modified",
      fieldId: SYNTHETIC,
      location: "Vùng khóa ngoài exception (Restrict Editing)",
      diffPreview: previewDiff(
        args.previousLockedFingerprint,
        args.newlyLockedFingerprint
      ),
    });
  }

  if (
    (template.hasStructuredFields || previous.hasStructuredFields) &&
    !newly.hasStructuredFields &&
    issues.length === 0
  ) {
    issues.push({
      type: "missing_field",
      location:
        "File mới không còn Content Control / vùng Restrict Editing như bản trước",
    });
  }

  return issues;
}

function lockedFingerprint(inv: DocxFieldInventory): string | undefined {
  const locked = inv.contentControls.filter((c) => c.locked);
  if (!locked.length) return undefined;
  return normalizeText(locked.map((c) => `${c.tag}:${c.value}`).join("|"));
}

export async function validateReuploadFromBuffers(args: {
  contractTypeId: string;
  templateBytes: ArrayBuffer;
  previousBytes: ArrayBuffer;
  newlyBytes: ArrayBuffer;
  currentVersion: number;
  templateFileName?: string;
  previousFileName?: string;
  newlyFileName?: string;
}): Promise<ReuploadValidationResult> {
  const [template, previous, newly] = await Promise.all([
    analyzeDocxContentControls(args.templateBytes, args.templateFileName),
    analyzeDocxContentControls(args.previousBytes, args.previousFileName),
    analyzeDocxContentControls(args.newlyBytes, args.newlyFileName),
  ]);

  const issues = compareDocxStructures({
    template,
    previous,
    newly,
    previousLockedFingerprint: lockedFingerprint(previous),
    newlyLockedFingerprint: lockedFingerprint(newly),
  });

  if (issues.length) {
    return { isValid: false, issues };
  }

  return {
    isValid: true,
    issues: [],
    newVersionNumber: args.currentVersion + 1,
  };
}

export function formatIssueMessage(issue: FieldStructureIssue): string {
  const loc = issue.location || issue.fieldId || "(không rõ vị trí)";
  switch (issue.type) {
    case "missing_field":
      return `Thiếu field/vùng: ${loc}${
        issue.fieldId ? ` (id: ${issue.fieldId})` : ""
      }`;
    case "locked_region_modified":
      return `Vùng khóa bị sửa: ${loc}${
        issue.diffPreview ? ` — ${issue.diffPreview}` : ""
      }`;
    case "unexpected_new_field":
      return `Field/vùng lạ không có trong template: ${loc}${
        issue.fieldId ? ` (id: ${issue.fieldId})` : ""
      }`;
    default:
      return loc;
  }
}
