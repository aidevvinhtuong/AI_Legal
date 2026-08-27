/**
 * System prompts — client service.
 * File I/O nằm ở backend; FE chỉ gọi API.
 */

import { api } from "@/lib/api";
import {
  PIPELINE_STAGES,
  STAGE_PLACEHOLDERS,
  type PipelineStage,
} from "@/lib/domain/system-prompts/constants";

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
  const data = (await api.put("/api/v1/system-prompts", { stage, content })) as {
    prompt: Omit<SystemPromptSnapshot, "placeholders"> & {
      placeholders?: readonly string[];
    };
  };
  return withPlaceholders(data.prompt);
}
