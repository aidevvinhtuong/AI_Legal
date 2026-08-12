/**
 * System prompts — client service.
 * File I/O nằm ở backend; FE chỉ gọi API (hoặc mock khi USE_MOCK).
 */

import { api, USE_MOCK } from "@/lib/api";
import {
  PIPELINE_STAGES,
  STAGE_PLACEHOLDERS,
  type PipelineStage,
} from "@/lib/system-prompts/constants";

export type { PipelineStage };
export { PIPELINE_STAGES, STAGE_PLACEHOLDERS };

export interface SystemPromptSnapshot {
  stage: PipelineStage;
  currentFile: string;
  content: string;
  placeholders: readonly string[];
  versions: string[];
}

const MOCK_PROMPTS: SystemPromptSnapshot[] = PIPELINE_STAGES.map((stage) => ({
  stage,
  currentFile: "v1.md",
  content: `{{/* Mock system prompt — ${stage} */}}\n\nChỉnh sửa prompts thật khi chạy backend (GET/PUT /api/system-prompts).\n`,
  placeholders: STAGE_PLACEHOLDERS[stage],
  versions: ["v1.md"],
}));

export async function fetchSystemPrompts(): Promise<SystemPromptSnapshot[]> {
  if (USE_MOCK) {
    return MOCK_PROMPTS.map((p) => ({ ...p, content: p.content }));
  }
  const data = (await api.get("/api/system-prompts")) as {
    prompts: SystemPromptSnapshot[];
  };
  return data.prompts || [];
}

export async function updateSystemPrompt(
  stage: PipelineStage,
  content: string
): Promise<SystemPromptSnapshot> {
  if (USE_MOCK) {
    const found = MOCK_PROMPTS.find((p) => p.stage === stage);
    if (!found) throw new Error(`Unknown stage: ${stage}`);
    found.content = content;
    return { ...found };
  }
  const data = (await api.put("/api/system-prompts", { stage, content })) as {
    prompt: SystemPromptSnapshot;
  };
  return data.prompt;
}
