export type PipelineStage =
  | "checklist_review"
  | "chat_edit"
  | "ai_summary_fairness";

export const PIPELINE_STAGES: PipelineStage[] = [
  "checklist_review",
  "chat_edit",
  "ai_summary_fairness",
];

/** Documented placeholders per stage — CI + runtime typo protection. */
export const STAGE_PLACEHOLDERS: Record<PipelineStage, readonly string[]> = {
  checklist_review: ["contract_type", "checklist_items", "document_text"],
  chat_edit: [
    "contract_type",
    "checklist_items",
    "conversation_history",
    "current_document_state",
  ],
  ai_summary_fairness: [
    "contract_type",
    "findings",
    "approval_matrix_context",
  ],
};

export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(template)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}
