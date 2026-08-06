import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  validateReupload,
} from "@/lib/reupload-validation-node";
import type { FieldStructureIssue } from "@/lib/reupload-validation";

/**
 * POST /api/reviews/[id]/reupload
 * Multipart: file (.docx)
 * Runs validateReupload before accepting a NEW review cycle.
 *
 * Mock note: without a real file store, this route validates against public samples
 * when query params templatePath / previousPath are provided; otherwise returns 501
 * for non-mock clients — FE mock path uses reuploadSubmit() client-side.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  const params = await Promise.resolve(ctx.params);
  const contractId = params.id;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Thiếu file .docx", issues: [] as FieldStructureIssue[] },
        { status: 400 }
      );
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json(
        {
          error: "File phải là .docx",
          issues: [
            {
              type: "unexpected_new_field",
              location: "Định dạng file không phải .docx",
            },
          ] satisfies FieldStructureIssue[],
        },
        { status: 400 }
      );
    }

    const templateRel =
      (form.get("templatePath") as string) ||
      "frontend/public/samples/1. Template_HDVT-OceanFreight_2026.docx";
    const previousRel =
      (form.get("previousPath") as string) || templateRel;
    const currentVersion = Number(form.get("currentVersion") || "1");
    const contractTypeId = String(form.get("contractTypeId") || "framework_goods");

    const root = path.join(process.cwd(), "..");
    const templatePath = path.isAbsolute(templateRel)
      ? templateRel
      : path.join(process.cwd(), templateRel.replace(/^frontend\//, ""));
    const previousPath = path.isAbsolute(previousRel)
      ? previousRel
      : path.join(process.cwd(), previousRel.replace(/^frontend\//, ""));

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reupload-"));
    const newlyPath = path.join(tmpDir, file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(newlyPath, buf);

    let result;
    try {
      result = await validateReupload(
        contractTypeId,
        templatePath,
        previousPath,
        newlyPath,
        currentVersion
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (!result.isValid) {
      return NextResponse.json(
        {
          error: "Cấu trúc file không hợp lệ",
          issues: result.issues,
          contractId,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      contractId,
      newVersionNumber: result.newVersionNumber,
      message:
        "Validation OK — backend sẽ kích hoạt checklist_review cho vòng review mới.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Lỗi validate reupload",
        issues: [] as FieldStructureIssue[],
      },
      { status: 500 }
    );
  }
}
