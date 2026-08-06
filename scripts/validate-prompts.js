#!/usr/bin/env node
/**
 * CI entry: validate all /prompts/** stage files.
 * Usage (from frontend/): npm run validate:prompts
 */

const fs = require("fs");
const path = require("path");

const STAGES = [
  "checklist_review",
  "chat_edit",
  "ai_summary_fairness",
  "field_validation",
];

const STAGE_PLACEHOLDERS = {
  checklist_review: ["contract_type", "checklist_items", "document_text"],
  chat_edit: [
    "contract_type",
    "checklist_items",
    "conversation_history",
    "current_document_state",
  ],
  ai_summary_fairness: ["contract_type", "findings", "approval_matrix_context"],
  field_validation: [
    "contract_type",
    "field_name",
    "old_value",
    "new_value",
    "approval_matrix_context",
  ],
};

const HARDCODED_PATTERNS = [
  { id: "days_threshold", re: /\b\d{1,3}\s*ngày\b/gi },
  { id: "percent_threshold", re: /\b\d{1,3}\s*%/g },
  { id: "payment_keyword", re: /thanh\s*toán\s*(trước|sau|trong)/gi },
  { id: "nda_years", re: /\b\d+\s*năm\s*(sau|bảo\s*mật)/gi },
  { id: "terminate_notice", re: /thông\s*báo\s*trước\s*\d+/gi },
  { id: "vat_amount", re: /\d{1,3}([.,]\d{3})+\s*(VND|đồng)/gi },
];

function findPromptsRoot() {
  const candidates = [
    path.join(process.cwd(), "prompts"),
    path.join(process.cwd(), "..", "prompts"),
  ];
  for (const d of candidates) {
    if (fs.existsSync(d)) return d;
  }
  throw new Error("Cannot find /prompts at repo root");
}

function extractPlaceholders(content) {
  const found = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(content)) !== null) found.add(m[1]);
  return Array.from(found);
}

function maskPlaceholders(content) {
  return content.replace(/\{\{[^}]*\}\}/g, "⟦PH⟧");
}

function validatePromptFile(stage, content) {
  const issues = [];
  const allowed = new Set(STAGE_PLACEHOLDERS[stage] || []);

  for (const name of extractPlaceholders(content)) {
    if (!allowed.has(name)) {
      issues.push({
        severity: "error",
        rule: "unknown_placeholder",
        message: `Unknown placeholder {{${name}}} for stage "${stage}"`,
      });
    }
  }

  const masked = maskPlaceholders(content);
  for (const { id, re } of HARDCODED_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      issues.push({
        severity: "error",
        rule: "hardcoded_business_rule",
        message: `Possible hardcoded Legal rule (${id}): "${m[0]}"`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

function main() {
  const root = findPromptsRoot();
  let failed = false;

  const guardPath = path.join(root, "_shared", "injection_guard.md");
  if (!fs.existsSync(guardPath)) {
    console.error("FAIL  missing prompts/_shared/injection_guard.md");
    failed = true;
  } else {
    const guard = fs.readFileSync(guardPath, "utf8");
    const ph = extractPlaceholders(guard);
    if (ph.length) {
      failed = true;
      console.error(
        `FAIL  _shared/injection_guard.md must not contain placeholders: ${ph
          .map((p) => `{{${p}}}`)
          .join(", ")}`
      );
    } else {
      console.log("OK    _shared/injection_guard.md");
    }
  }

  for (const stage of STAGES) {
    const stageDir = path.join(root, stage);
    if (!fs.existsSync(stageDir)) {
      console.error(`FAIL  missing stage folder: ${stage}`);
      failed = true;
      continue;
    }

    const files = fs
      .readdirSync(stageDir)
      .filter((f) => f.endsWith(".md"));

    if (!files.length) {
      console.error(`FAIL  ${stage}: no .md version files`);
      failed = true;
      continue;
    }

    const currentJson = path.join(stageDir, "current.json");
    if (fs.existsSync(currentJson)) {
      const ptr = JSON.parse(fs.readFileSync(currentJson, "utf8"));
      if (!ptr.file || !fs.existsSync(path.join(stageDir, ptr.file))) {
        console.error(`FAIL  ${stage}: current.json points to missing file`);
        failed = true;
      } else {
        console.log(`OK    ${stage}/current.json → ${ptr.file}`);
      }
    } else {
      console.error(`FAIL  ${stage}: missing current.json`);
      failed = true;
    }

    for (const file of files) {
      const content = fs.readFileSync(path.join(stageDir, file), "utf8");
      const result = validatePromptFile(stage, content);
      if (!result.ok) {
        failed = true;
        console.error(`FAIL  ${stage}/${file}`);
        for (const issue of result.issues) {
          console.error(`       [${issue.rule}] ${issue.message}`);
        }
      } else {
        console.log(`OK    ${stage}/${file}`);
      }
    }
  }

  if (failed) {
    console.error(
      "\nPrompt validation failed. Do not hardcode Legal clause rules; fix unknown placeholders."
    );
    process.exit(1);
  }
  console.log("\nAll prompts validated.");
}

main();
