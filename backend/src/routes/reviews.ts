import path from "path";
import fs from "fs/promises";
import os from "os";
import type { Request, Response } from "express";
import multer from "multer";
import { validateReupload } from "../lib/reupload-validation-node";
import type { FieldStructureIssue } from "../lib/reupload-validation";

export const reuploadUpload = multer({ storage: multer.memoryStorage() });

function repoRoot(): string {
  return path.join(process.cwd(), "..");
}

export async function reuploadReview(req: Request, res: Response) {
  const contractId = req.params.id;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        error: "Thiếu file .docx",
        issues: [] as FieldStructureIssue[],
      });
    }
    if (!file.originalname.toLowerCase().endsWith(".docx")) {
      return res.status(400).json({
        error: "File phải là .docx",
        issues: [
          {
            type: "unexpected_new_field",
            location: "Định dạng file không phải .docx",
          },
        ] satisfies FieldStructureIssue[],
      });
    }

    const templateRel =
      (req.body.templatePath as string) ||
      "frontend/public/samples/1. Template_HDVT-OceanFreight_2026.docx";
    const previousRel = (req.body.previousPath as string) || templateRel;
    const currentVersion = Number(req.body.currentVersion || "1");
    const contractTypeId = String(
      req.body.contractTypeId || "framework_goods"
    );

    const root = repoRoot();
    const templatePath = path.isAbsolute(templateRel)
      ? templateRel
      : path.join(root, templateRel);
    const previousPath = path.isAbsolute(previousRel)
      ? previousRel
      : path.join(root, previousRel);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reupload-"));
    const newlyPath = path.join(tmpDir, file.originalname);
    await fs.writeFile(newlyPath, file.buffer);

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
      return res.status(422).json({
        error: "Cấu trúc file không hợp lệ",
        issues: result.issues,
        contractId,
      });
    }

    return res.json({
      ok: true,
      contractId,
      newVersionNumber: result.newVersionNumber,
      message:
        "Validation OK — backend sẽ kích hoạt checklist_review cho vòng review mới.",
    });
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Lỗi validate reupload",
      issues: [] as FieldStructureIssue[],
    });
  }
}
