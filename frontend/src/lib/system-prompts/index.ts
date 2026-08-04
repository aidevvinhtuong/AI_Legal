/**
 * File-based system prompts (IT-owned).
 * Source of truth: `/prompts/<stage>/` at repo root.
 */

import fs from "fs";
import path from "path";
import {
  PIPELINE_STAGES,
  PLACEHOLDER_RE,
  STAGE_PLACEHOLDERS,
  extractPlaceholders,
  type PipelineStage,
} from "./constants";
import { validatePromptFile } from "./validate";

export type { PipelineStage };
export { PIPELINE_STAGES, STAGE_PLACEHOLDERS, extractPlaceholders };

function resolvePromptsRoot(): string {
  const candidates = [
    path.join(process.cwd(), "prompts"),
    path.join(process.cwd(), "..", "prompts"),
    path.join(__dirname, "..", "..", "..", "..", "prompts"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    `Cannot find /prompts directory (cwd=${process.cwd()}). Expected at repo root.`
  );
}

const INJECTION_GUARD_REL = path.join("_shared", "injection_guard.md");

function readCurrentPointer(stageDir: string): string {
  const jsonPath = path.join(stageDir, "current.json");
  const symlinkPath = path.join(stageDir, "CURRENT");

  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      file?: string;
    };
    if (!raw.file) throw new Error(`Invalid current.json in ${stageDir}`);
    return raw.file;
  }

  if (fs.existsSync(symlinkPath)) {
    const stat = fs.lstatSync(symlinkPath);
    if (stat.isSymbolicLink()) {
      return path.basename(fs.readlinkSync(symlinkPath));
    }
    return fs.readFileSync(symlinkPath, "utf8").trim();
  }

  throw new Error(
    `Missing CURRENT pointer in ${stageDir} (need current.json or CURRENT symlink)`
  );
}

/** Shared injection-guard text prepended to every stage at load time. */
export function loadInjectionGuard(): string {
  const root = resolvePromptsRoot();
  const filePath = path.join(root, INJECTION_GUARD_REL);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing shared injection guard: ${filePath}. Expected /prompts/_shared/injection_guard.md`
    );
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Load stage prompt file only (no injection guard) — for IT console edit/save.
 */
export function loadSystemPromptRaw(stage: PipelineStage): string {
  if (!PIPELINE_STAGES.includes(stage)) {
    throw new Error(`Unknown pipeline stage: ${stage}`);
  }
  const root = resolvePromptsRoot();
  const stageDir = path.join(root, stage);
  const fileName = readCurrentPointer(stageDir);
  const filePath = path.join(stageDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }
  // Prevent path traversal — file must stay inside stageDir
  if (path.resolve(path.dirname(filePath)) !== path.resolve(stageDir)) {
    throw new Error("Invalid prompt path");
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Load composed system prompt for a pipeline stage:
 * injection_guard + stage CURRENT (no placeholder substitution).
 */
export function loadSystemPrompt(stage: PipelineStage): string {
  const guard = loadInjectionGuard().trimEnd();
  const body = loadSystemPromptRaw(stage).trimStart();
  return `${guard}\n\n---\n\n${body}`;
}

export interface SystemPromptSnapshot {
  stage: PipelineStage;
  currentFile: string;
  content: string;
  placeholders: readonly string[];
  versions: string[];
}

/** List all stages with current content — for IT console (raw, without guard). */
export function listSystemPrompts(): SystemPromptSnapshot[] {
  const root = resolvePromptsRoot();
  return PIPELINE_STAGES.map((stage) => {
    const stageDir = path.join(root, stage);
    const currentFile = readCurrentPointer(stageDir);
    const content = loadSystemPromptRaw(stage);
    const versions = fs
      .readdirSync(stageDir)
      .filter((f) => /^v\d+\.md$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return {
      stage,
      currentFile,
      content,
      placeholders: STAGE_PLACEHOLDERS[stage],
      versions,
    };
  });
}

/**
 * Overwrite the CURRENT prompt file for a stage (IT console).
 * Rejects unknown placeholders / hardcoded Legal heuristics.
 */
export function saveSystemPrompt(
  stage: PipelineStage,
  content: string
): SystemPromptSnapshot {
  if (!PIPELINE_STAGES.includes(stage)) {
    throw new Error(`Unknown pipeline stage: ${stage}`);
  }
  if (typeof content !== "string") {
    throw new Error("content phải là chuỗi");
  }

  const result = validatePromptFile(stage, content);
  const errors = result.issues.filter((i) => i.severity === "error");
  if (errors.length) {
    const msg = errors.map((e) => e.message).join("; ");
    throw new Error(`Validation failed: ${msg}`);
  }

  const root = resolvePromptsRoot();
  const stageDir = path.join(root, stage);
  const currentFile = readCurrentPointer(stageDir);
  if (!/^v\d+\.md$/i.test(currentFile)) {
    throw new Error(`Refusing to write non-version file: ${currentFile}`);
  }
  const filePath = path.join(stageDir, currentFile);
  // Prevent path traversal — file must stay inside stageDir
  if (path.dirname(filePath) !== stageDir) {
    throw new Error("Invalid prompt path");
  }
  fs.writeFileSync(filePath, content, "utf8");

  const versions = fs
    .readdirSync(stageDir)
    .filter((f) => /^v\d+\.md$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return {
    stage,
    currentFile,
    content,
    placeholders: STAGE_PLACEHOLDERS[stage],
    versions,
  };
}

/**
 * Simple `{{key}}` substitution.
 * Throws if the template uses a placeholder missing from `vars`.
 */
export function renderPrompt(
  template: string,
  vars: Record<string, string>
): string {
  const used = extractPlaceholders(template);
  const missing = used.filter((k) => !(k in vars));
  if (missing.length) {
    throw new Error(
      `Missing prompt variables: ${missing.map((k) => `{{${k}}}`).join(", ")}`
    );
  }
  return template.replace(PLACEHOLDER_RE, (_, key: string) => vars[key] ?? "");
}

export {
  validatePromptFile,
  type PromptValidationIssue,
  type PromptValidationResult,
} from "./validate";
