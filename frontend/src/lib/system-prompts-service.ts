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

/** Đúng hình dạng `GET/PUT /api/v1/system-prompts` trả về. */
export interface SystemPromptSnapshot {
  stage: PipelineStage;
  /** Tên file đang được `current.json` trỏ tới, ví dụ `v2.md`. */
  fileName: string;
  content: string;
  /**
   * BE chỉ trả trường này ở GET; PUT trả bản rút gọn. Service điền bù từ
   * `STAGE_PLACEHOLDERS` để UI không phải kiểm tra undefined ở mọi chỗ dùng —
   * hai danh sách vốn phải khớp nhau, CI `validate-prompts` canh việc đó.
   */
  placeholders: readonly string[];
  updatedAt?: string | null;
  /** Stage đọc lỗi (thiếu `current.json`…) — BE báo thay vì im lặng. */
  error?: string;
}

const MOCK_PROMPTS: SystemPromptSnapshot[] = PIPELINE_STAGES.map((stage) => ({
  stage,
  fileName: "v1.md",
  content: `{{/* Mock system prompt — ${stage} */}}\n\nChỉnh sửa prompts thật khi chạy backend (GET/PUT /api/system-prompts).\n`,
  placeholders: STAGE_PLACEHOLDERS[stage],
}));

function withPlaceholders(
  raw: Omit<SystemPromptSnapshot, "placeholders"> & {
    placeholders?: readonly string[];
  }
): SystemPromptSnapshot {
  return {
    ...raw,
    placeholders: raw.placeholders ?? STAGE_PLACEHOLDERS[raw.stage] ?? [],
  };
}

export async function fetchSystemPrompts(): Promise<SystemPromptSnapshot[]> {
  if (USE_MOCK) {
    return MOCK_PROMPTS.map((p) => ({ ...p, content: p.content }));
  }
  const data = (await api.get("/api/v1/system-prompts")) as {
    prompts: (Omit<SystemPromptSnapshot, "placeholders"> & {
      placeholders?: readonly string[];
    })[];
  };
  return (data.prompts || []).map(withPlaceholders);
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
  const data = (await api.put("/api/v1/system-prompts", { stage, content })) as {
    prompt: Omit<SystemPromptSnapshot, "placeholders"> & {
      placeholders?: readonly string[];
    };
  };
  return withPlaceholders(data.prompt);
}
