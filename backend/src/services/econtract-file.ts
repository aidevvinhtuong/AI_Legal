import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import JSZip from "jszip";
import type { SignRecipient } from "../lib/types";
import { buildMarkerSyntax, recipientNeedsMarker } from "../lib/econtract-flow";

const execFileAsync = promisify(execFile);

/** Chèn marker mực trắng vào cuối body document.xml của .docx */
export async function injectMarkersIntoDocx(
  docxBytes: ArrayBuffer | Buffer,
  recipients: SignRecipient[]
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("File Word không hợp lệ (thiếu word/document.xml)");
  let xml = await docFile.async("string");

  const markers = recipients
    .filter(recipientNeedsMarker)
    .filter((r) => r.marker)
    .map((r) => buildMarkerSyntax(r))
    .filter(Boolean);

  if (!markers.length) {
    throw new Error("Không có marker để chèn vào file Word");
  }

  const runs = markers
    .map(
      (text) =>
        `<w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="2"/></w:rPr><w:t xml:space="preserve">${escapeXml(
          text
        )}</w:t></w:r>`
    )
    .join("");

  const paragraph = `<w:p>${runs}</w:p>`;
  if (xml.includes("</w:body>")) {
    xml = xml.replace("</w:body>", `${paragraph}</w:body>`);
  } else {
    throw new Error("Không tìm thấy </w:body> trong document.xml");
  }

  zip.file("word/document.xml", xml);
  const out = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.from(out);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function findSoffice(): Promise<string | null> {
  for (const bin of ["soffice", "libreoffice"]) {
    try {
      await execFileAsync("which", [bin]);
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Convert .docx → .pdf bằng LibreOffice headless nếu có.
 * Trả về { pdf, mode } hoặc fallback docx.
 */
export async function convertDocxToPdf(
  docxBuffer: Buffer,
  baseName = "contract"
): Promise<{ buffer: Buffer; mode: "pdf" | "docx"; note?: string }> {
  const soffice = await findSoffice();
  if (!soffice) {
    return {
      buffer: docxBuffer,
      mode: "docx",
      note: "Chưa cài LibreOffice — gửi .docx (FPT ví dụ API chấp nhận .docx). Cài soffice để convert PDF.",
    };
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ai-legal-ec-"));
  const docxPath = path.join(tmp, `${baseName}.docx`);
  try {
    await fs.writeFile(docxPath, docxBuffer);
    await execFileAsync(
      soffice,
      ["--headless", "--convert-to", "pdf", "--outdir", tmp, docxPath],
      { timeout: 120_000 }
    );
    const pdfPath = path.join(tmp, `${baseName}.pdf`);
    const pdf = await fs.readFile(pdfPath);
    return { buffer: pdf, mode: "pdf" };
  } catch (e) {
    return {
      buffer: docxBuffer,
      mode: "docx",
      note: `Convert PDF lỗi (${e instanceof Error ? e.message : "unknown"}) — fallback .docx`,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function prepareEcontractFileBase64(
  docxBytes: ArrayBuffer | Buffer,
  recipients: SignRecipient[],
  fileName: string
): Promise<{
  base64: string;
  fileName: string;
  mode: "pdf" | "docx";
  note?: string;
}> {
  const withMarkers = await injectMarkersIntoDocx(docxBytes, recipients);
  const base = fileName.replace(/\.(docx|pdf)$/i, "") || "contract";
  const converted = await convertDocxToPdf(withMarkers, base);
  return {
    base64: converted.buffer.toString("base64"),
    fileName:
      converted.mode === "pdf" ? `${base}.pdf` : `${base}.docx`,
    mode: converted.mode,
    note: converted.note,
  };
}
