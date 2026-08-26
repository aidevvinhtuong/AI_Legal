/**
 * Trích text từng đoạn bằng CHÍNH bộ chuyển đổi của SuperDoc, theo đúng quy ước
 * `NODE_AS_TEXT` của `frontend/src/components/review/superdoc-embed.tsx`.
 *
 * Chạy trong container `frontend` (cần `@harbour-enterprises/superdoc`).
 * Ghi kết quả ra stdout dạng JSON.
 */
import fs from "node:fs";
import { DocxZipper, SuperConverter } from "@harbour-enterprises/superdoc";

// Phải khớp `NODE_AS_TEXT` bên superdoc-embed.tsx, và khớp `run_text()` của
// `backend/app/services/document/ooxml.py`.
const AS_TEXT = { tab: "\t", hardBreak: "\n" };

const path = process.argv[2];
if (!path) {
  console.error("dùng: node extract.mjs <file.docx>");
  process.exit(2);
}

// JSZip trong Node không đọc được Blob/File (cần FileReader) — truyền bytes thô
const zipper = new DocxZipper();
const docx = await zipper.getDocxData(new Uint8Array(fs.readFileSync(path)), true);
const schema = new SuperConverter({ docx }).getSchema();

const out = [];
const walk = (node) => {
  if (!node) return;
  if (node.type === "paragraph") {
    let text = "";
    const collect = (n) => {
      if (!n) return;
      if (n.type === "text" && typeof n.text === "string") text += n.text;
      else if (AS_TEXT[n.type] !== undefined) text += AS_TEXT[n.type];
      (n.content || []).forEach(collect);
    };
    (node.content || []).forEach(collect);
    out.push({ paraId: node.attrs?.paraId ?? null, text });
    return;
  }
  (node.content || []).forEach(walk);
};
walk(schema);

process.stdout.write(JSON.stringify(out));
