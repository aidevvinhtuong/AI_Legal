import { NextResponse } from "next/server";
import {
  listSystemPrompts,
  saveSystemPrompt,
  PIPELINE_STAGES,
  type PipelineStage,
} from "@/lib/system-prompts";

/** Snapshot of file-based system prompts (IT console). */
export async function GET() {
  try {
    const prompts = listSystemPrompts();
    return NextResponse.json({ prompts });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Không đọc được system prompts",
      },
      { status: 500 }
    );
  }
}

/** Save CURRENT prompt file for a stage (IT console). */
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      stage?: string;
      content?: string;
    };
    const stage = body.stage as PipelineStage | undefined;
    if (!stage || !PIPELINE_STAGES.includes(stage)) {
      return NextResponse.json(
        { error: `stage không hợp lệ. Allowed: ${PIPELINE_STAGES.join(", ")}` },
        { status: 400 }
      );
    }
    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "Thiếu content (string)" },
        { status: 400 }
      );
    }

    const prompt = saveSystemPrompt(stage, body.content);
    return NextResponse.json({ prompt });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Không lưu được system prompt",
      },
      { status: 400 }
    );
  }
}
