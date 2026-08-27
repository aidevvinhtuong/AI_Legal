/**
 * Phương thức 2 — validate re-uploaded .docx before starting a NEW AI review cycle.
 * Buffer-based (safe for browser + Node). Path-based helper lives in reupload-validation-node.ts.
 */

import {
  analyzeDocxContentControls,
  type DocxContentControl,
  type DocxFieldInventory,
} from "@/lib/docx/content-controls";

/**
 * Một điểm không khớp cấu trúc, do backend phát ra.
 *
 * Bảy loại, không phải ba. Bản đầu của type này chỉ khai ba loại của lớp validate
 * phía FE, nên bốn loại còn lại của backend rơi vào nhánh `default` của
 * `formatIssueMessage` và **mất `diffPreview`** — đúng chỗ chứa lời khuyên hành
 * động. Ví dụ `mechanism_mismatch` mang câu "Nhiều khả năng Restrict Editing đã
 * bị gỡ. Hãy tải lại template gốc", mà người dùng lại chỉ thấy tên vị trí.
 */
export type FieldStructureIssueType =
  | "missing_field"
  | "unexpected_new_field"
  | "locked_region_modified"
  | "mechanism_mismatch"
  | "protection_removed"
  | "count_mismatch"
  | "region_kind_changed";

export interface FieldStructureIssue {
  type: FieldStructureIssueType | string;
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

/** Nhãn tiếng Việt cho từng loại. Khoá phải khớp `structural_binding.py`. */
const ISSUE_LABEL: Record<string, string> = {
  missing_field: "Thiếu vùng",
  unexpected_new_field: "Vùng lạ không có trong bản gốc",
  locked_region_modified: "Vùng khoá bị sửa",
  mechanism_mismatch: "Cơ chế khoá tài liệu đã đổi",
  protection_removed: "Bảo vệ tài liệu đã bị gỡ",
  count_mismatch: "Số vùng mở không khớp",
  region_kind_changed: "Loại vùng mở đã đổi",
};

export function formatIssueMessage(issue: FieldStructureIssue): string {
  const loc = issue.location || issue.fieldId || "(không rõ vị trí)";
  const label = ISSUE_LABEL[issue.type] || "Không khớp cấu trúc";
  const id =
    issue.fieldId && !loc.includes(issue.fieldId) ? ` (id: ${issue.fieldId})` : "";
  // `diffPreview` LUÔN được nối vào — với `mechanism_mismatch` và
  // `protection_removed` thì đó là phần duy nhất nói cho người dùng biết phải
  // làm gì. Bản trước bỏ nó ở nhánh default.
  const detail = issue.diffPreview ? ` — ${issue.diffPreview}` : "";
  return `${label}: ${loc}${id}${detail}`;
}
