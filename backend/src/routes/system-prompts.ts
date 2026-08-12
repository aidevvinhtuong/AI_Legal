import type { Request, Response } from "express";
import {
  listSystemPrompts,
  saveSystemPrompt,
  PIPELINE_STAGES,
  type PipelineStage,
} from "../lib/system-prompts";

export function getSystemPrompts(_req: Request, res: Response) {
  try {
    const prompts = listSystemPrompts();
    return res.json({ prompts });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Không đọc được system prompts",
    });
  }
}

export function putSystemPrompt(req: Request, res: Response) {
  try {
    const body = req.body as { stage?: string; content?: string };
    const stage = body.stage as PipelineStage | undefined;
    if (!stage || !PIPELINE_STAGES.includes(stage)) {
      return res.status(400).json({
        error: `stage không hợp lệ. Allowed: ${PIPELINE_STAGES.join(", ")}`,
      });
    }
    if (typeof body.content !== "string") {
      return res.status(400).json({ error: "Thiếu content (string)" });
    }
    const prompt = saveSystemPrompt(stage, body.content);
    return res.json({ prompt });
  } catch (e) {
    return res.status(400).json({
      error: e instanceof Error ? e.message : "Không lưu được system prompt",
    });
  }
}
