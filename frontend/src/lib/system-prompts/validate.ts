/**
 * CI / PR validation for `/prompts/**` — no hardcoded Legal rules + placeholder typo check.
 */

import {
  STAGE_PLACEHOLDERS,
  extractPlaceholders,
  type PipelineStage,
} from "./constants";

export type PromptValidationIssue = {
  severity: "error" | "warning";
  rule: "unknown_placeholder" | "hardcoded_business_rule";
  message: string;
  detail?: string;
};

export type PromptValidationResult = {
  ok: boolean;
  issues: PromptValidationIssue[];
};

/**
 * Heuristic: Vietnamese legal / threshold phrases that belong in Legal checklist,
 * not in IT system prompts — unless inside `{{placeholder}}`.
 */
const HARDCODED_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "days_threshold", re: /\b\d{1,3}\s*ngày\b/gi },
  { id: "percent_threshold", re: /\b\d{1,3}\s*%/g },
  { id: "payment_keyword", re: /thanh\s*toán\s*(trước|sau|trong)/gi },
  { id: "nda_years", re: /\b\d+\s*năm\s*(sau|bảo\s*mật)/gi },
  { id: "terminate_notice", re: /thông\s*báo\s*trước\s*\d+/gi },
  { id: "vat_amount", re: /\d{1,3}([.,]\d{3})+\s*(VND|đồng)/gi },
];

/** Mask `{{...}}` regions so heuristics don't scan inside placeholders. */
function maskPlaceholders(content: string): string {
  return content.replace(/\{\{[^}]*\}\}/g, "⟦PH⟧");
}

/**
 * Validate a prompt file for a given pipeline stage.
 * Fail CI if unknown placeholders or hardcoded clause-like content is detected.
 */
export function validatePromptFile(
  stage: PipelineStage,
  content: string
): PromptValidationResult {
  const issues: PromptValidationIssue[] = [];
  const allowed = new Set(STAGE_PLACEHOLDERS[stage] || []);

  for (const name of extractPlaceholders(content)) {
    if (!allowed.has(name)) {
      issues.push({
        severity: "error",
        rule: "unknown_placeholder",
        message: `Unknown placeholder {{${name}}} for stage "${stage}"`,
        detail: `Allowed: ${Array.from(allowed)
          .map((k) => `{{${k}}}`)
          .join(", ")}`,
      });
    }
  }

  const masked = maskPlaceholders(content);
  for (const { id, re } of HARDCODED_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      issues.push({
        severity: "error",
        rule: "hardcoded_business_rule",
        message: `Possible hardcoded Legal rule (${id}): "${m[0]}"`,
        detail:
          "Move business thresholds / clause wording into Legal checklist config and inject via {{checklist_items}} (or the stage's documented placeholders).",
      });
    }
  }

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}
