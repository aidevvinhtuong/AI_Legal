/**
 * Server-only path-based validateReupload (Node fs).
 * Do not import from client components.
 */

import fs from "fs/promises";
import {
  validateReuploadFromBuffers,
  type ReuploadValidationResult,
} from "./reupload-validation";

async function loadBufferFromPath(filePath: string): Promise<ArrayBuffer> {
  const buf = await fs.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * @param contractTypeId - loại HĐ
 * @param originalTemplateDocxPath - template Legal (Mục 6)
 * @param previousVersionDocxPath - bản ngay trước re-upload
 * @param newlyUploadedDocxPath - file vừa upload
 */
export async function validateReupload(
  contractTypeId: string,
  originalTemplateDocxPath: string,
  previousVersionDocxPath: string,
  newlyUploadedDocxPath: string,
  currentVersion = 1
): Promise<ReuploadValidationResult> {
  const [templateBytes, previousBytes, newlyBytes] = await Promise.all([
    loadBufferFromPath(originalTemplateDocxPath),
    loadBufferFromPath(previousVersionDocxPath),
    loadBufferFromPath(newlyUploadedDocxPath),
  ]);

  return validateReuploadFromBuffers({
    contractTypeId,
    templateBytes,
    previousBytes,
    newlyBytes,
    currentVersion,
    templateFileName: originalTemplateDocxPath.split(/[/\\]/).pop(),
    previousFileName: previousVersionDocxPath.split(/[/\\]/).pop(),
    newlyFileName: newlyUploadedDocxPath.split(/[/\\]/).pop(),
  });
}
