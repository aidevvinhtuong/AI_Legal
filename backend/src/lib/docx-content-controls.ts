/**
 * Detect open vs locked regions in .docx:
 * 1) Content Controls (w:sdt + w:lock)
 * 2) Restrict Editing exceptions (w:permStart / w:permEnd) — used by LOG HDVT templates
 */

import JSZip from "jszip";
import type { EditableField } from "./types";

export type ContentControlLockKind =
  | "none"
  | "sdtLocked"
  | "sdtContentLocked"
  | "contentLocked"
  | "unknown";

export type FieldDetectionMechanism =
  | "content_control"
  | "permission_range"
  | "none";

export interface DocxContentControl {
  id: string;
  tag: string;
  alias: string;
  value: string;
  locked: boolean;
  lockKind: ContentControlLockKind;
  order: number;
  mechanism: FieldDetectionMechanism;
}

export interface DocxFieldInventory {
  fileName?: string;
  contentControls: DocxContentControl[];
  openCount: number;
  lockedCount: number;
  mechanism: FieldDetectionMechanism;
  documentProtection: {
    enforced: boolean;
    edit?: string;
  } | null;
  /** true when we found structured open/locked regions */
  hasStructuredFields: boolean;
  note?: string;
  source: "ooxml";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractText(block: string): string {
  const parts: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    parts.push(decodeXmlEntities(m[1]));
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function parseLockKind(sdtPr: string): ContentControlLockKind {
  const m = sdtPr.match(/<w:lock[^>]*w:val\s*=\s*"([^"]+)"/i);
  if (!m) {
    if (/<w:lock[\s/>]/i.test(sdtPr)) return "unknown";
    return "none";
  }
  const v = m[1];
  if (v === "sdtLocked" || v === "sdtContentLocked" || v === "contentLocked") {
    return v;
  }
  return "unknown";
}

function parseDocumentProtection(
  settingsXml: string | null
): DocxFieldInventory["documentProtection"] {
  if (!settingsXml) return null;
  const m = settingsXml.match(/<w:documentProtection\b([^>]*)\/?>/i);
  if (!m) return null;
  const attrs = m[1] || "";
  const editM = attrs.match(/w:edit\s*=\s*"([^"]*)"/i);
  const enfM = attrs.match(/w:enforcement\s*=\s*"([^"]*)"/i);
  const enforcement = enfM?.[1] || "0";
  return {
    enforced: enforcement === "1" || enforcement === "true",
    edit: editM?.[1],
  };
}

export function parseContentControlsFromDocumentXml(
  documentXml: string
): DocxContentControl[] {
  const controls: DocxContentControl[] = [];
  const re = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(documentXml)) !== null) {
    const block = m[0];
    const prMatch = block.match(/<w:sdtPr\b[\s\S]*?<\/w:sdtPr>/);
    const sdtPr = prMatch?.[0] || "";
    const tagM = sdtPr.match(/<w:tag\b[^>]*w:val\s*=\s*"([^"]*)"/i);
    const aliasM = sdtPr.match(/<w:alias\b[^>]*w:val\s*=\s*"([^"]*)"/i);
    const idM = sdtPr.match(/<w:id\b[^>]*w:val\s*=\s*"([^"]*)"/i);
    const tag = tagM ? decodeXmlEntities(tagM[1]) : "";
    const alias = aliasM ? decodeXmlEntities(aliasM[1]) : "";
    const xmlId = idM ? idM[1] : String(order);
    const lockKind = parseLockKind(sdtPr);
    const locked = lockKind !== "none";
    const contentMatch = block.match(/<w:sdtContent\b[\s\S]*?<\/w:sdtContent>/);
    const value = contentMatch ? extractText(contentMatch[0]) : "";
    const resolvedTag = tag || `sdt_${xmlId}`;
    controls.push({
      id: resolvedTag,
      tag: resolvedTag,
      alias: alias || resolvedTag,
      value,
      locked,
      lockKind,
      order,
      mechanism: "content_control",
    });
    order += 1;
  }
  return controls;
}

/** Editable exception ranges from Word Restrict Editing. */
export function parsePermissionRangesFromDocumentXml(
  documentXml: string
): DocxContentControl[] {
  const starts: { id: string; pos: number; edGrp?: string }[] = [];
  const startRe = /<w:permStart\b([^>]*)\/?>/g;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(documentXml)) !== null) {
    const attrs = sm[1] || "";
    const id = attrs.match(/w:id\s*=\s*"([^"]*)"/i)?.[1];
    if (!id) continue;
    starts.push({
      id,
      pos: sm.index,
      edGrp: attrs.match(/w:edGrp\s*=\s*"([^"]*)"/i)?.[1],
    });
  }

  const endPos = new Map<string, number>();
  const endRe = /<w:permEnd\b([^>]*)\/?>/g;
  let em: RegExpExecArray | null;
  while ((em = endRe.exec(documentXml)) !== null) {
    const id = (em[1] || "").match(/w:id\s*=\s*"([^"]*)"/i)?.[1];
    if (id) endPos.set(id, em.index + em[0].length);
  }

  const controls: DocxContentControl[] = [];
  let order = 0;
  for (const s of starts) {
    const end = endPos.get(s.id);
    if (end == null || end <= s.pos) continue;
    const chunk = documentXml.slice(s.pos, end);
    const value = extractText(chunk);
    const preview = value.slice(0, 80) || "(trống)";
    const alias =
      value.length <= 40
        ? `Vùng mở: ${preview}`
        : `Vùng mở #${order + 1}: ${preview}${value.length > 80 ? "…" : ""}`;
    controls.push({
      id: `perm_${s.id}`,
      tag: `perm_${s.id}`,
      alias,
      value,
      locked: false,
      lockKind: "none",
      order,
      mechanism: "permission_range",
    });
    order += 1;
  }
  return controls;
}

export async function analyzeDocxContentControls(
  data: ArrayBuffer | Uint8Array,
  fileName?: string
): Promise<DocxFieldInventory> {
  const zip = await JSZip.loadAsync(data);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Không tìm thấy word/document.xml trong .docx");
  }
  const documentXml = await docFile.async("string");
  const settingsFile = zip.file("word/settings.xml");
  const settingsXml = settingsFile ? await settingsFile.async("string") : null;
  const documentProtection = parseDocumentProtection(settingsXml);

  const sdtControls = parseContentControlsFromDocumentXml(documentXml);
  if (sdtControls.length > 0) {
    const openCount = sdtControls.filter((c) => !c.locked).length;
    const lockedCount = sdtControls.filter((c) => c.locked).length;
    return {
      fileName,
      contentControls: sdtControls,
      openCount,
      lockedCount,
      mechanism: "content_control",
      documentProtection,
      hasStructuredFields: true,
      note: "Nhận diện bằng Content Control (w:sdt).",
      source: "ooxml",
    };
  }

  const permControls = parsePermissionRangesFromDocumentXml(documentXml);
  if (permControls.length > 0) {
    // Outside permission ranges = locked body (Word Restrict Editing model)
    const lockedBody: DocxContentControl = {
      id: "doc_body_locked",
      tag: "doc_body_locked",
      alias: "Phần còn lại của hợp đồng (ngoài vùng exception)",
      value:
        "Khóa theo Restrict Editing — chỉ các vùng mở (exception) được phép sửa khi bảo vệ tài liệu bật.",
      locked: true,
      lockKind: "contentLocked",
      order: permControls.length,
      mechanism: "permission_range",
    };
    const contentControls = [...permControls, lockedBody];
    return {
      fileName,
      contentControls,
      openCount: permControls.length,
      lockedCount: 1,
      mechanism: "permission_range",
      documentProtection,
      hasStructuredFields: true,
      note:
        documentProtection?.edit === "readOnly"
          ? `Restrict Editing (readOnly), enforcement=${
              documentProtection.enforced ? "ON" : "OFF trong file"
            }. Vùng w:permStart = được sửa.`
          : "Restrict Editing exceptions (w:permStart) — coi là field mở.",
      source: "ooxml",
    };
  }

  return {
    fileName,
    contentControls: [],
    openCount: 0,
    lockedCount: 0,
    mechanism: "none",
    documentProtection,
    hasStructuredFields: false,
    note:
      "Không có Content Control (w:sdt) và không có vùng Restrict Editing (w:permStart). Không thể tự phân biệt khóa/mở từ OOXML.",
    source: "ooxml",
  };
}

export async function analyzeDocxFromUrl(
  url: string,
  fileName?: string
): Promise<DocxFieldInventory> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  return analyzeDocxContentControls(buf, fileName || url.split("/").pop());
}

export function contentControlsToEditableFields(
  inventory: DocxFieldInventory
): EditableField[] {
  return inventory.contentControls.map((c) => ({
    id: c.tag,
    label: c.alias || c.tag,
    type: "text" as const,
    value: c.value,
    locked: c.locked,
  }));
}
