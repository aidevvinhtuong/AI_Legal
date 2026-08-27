/**
 * Số tài liệu tự sinh:
 *   (Mã công ty).(Mã loại hợp đồng).Năm+STT
 * Ví dụ: VTS.HQP.260001
 * STT tăng theo từng công ty (trong cùng năm YY).
 */

import type { ContractReview } from "@/lib/types";

const SEQ_KEY = "ai_econtract_doc_seq_v1";

export type DocSeqState = Record<string, number>; // key = `${companyCode}.${yy}` → last seq

export function documentNumberYear(date = new Date()): string {
  return String(date.getFullYear()).slice(-2);
}

export function formatDocumentNumber(
  companyCode: string,
  categoryCode: string,
  year: string,
  seq: number
): string {
  return `${companyCode}.${categoryCode}.${year}${String(seq).padStart(4, "0")}`;
}

/** Parse VTS.HQP.260001 → parts; null nếu không khớp. */
export function parseDocumentNumber(raw: string): {
  companyCode: string;
  categoryCode: string;
  year: string;
  seq: number;
} | null {
  const m = String(raw || "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z0-9]+)\.([A-Z0-9]+)\.(\d{2})(\d{4})$/);
  if (!m) return null;
  return {
    companyCode: m[1],
    categoryCode: m[2],
    year: m[3],
    seq: Number(m[4]),
  };
}

function loadSeqState(): DocSeqState {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SEQ_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DocSeqState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeqState(state: DocSeqState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEQ_KEY, JSON.stringify(state));
}

function seqKey(companyCode: string, year: string) {
  return `${companyCode.toUpperCase()}.${year}`;
}

/** Đồng bộ counter từ danh sách HĐ hiện có (tránh trùng số sau seed / import). */
export function syncDocSeqFromReviews(reviews: ContractReview[]): void {
  const state = loadSeqState();
  let changed = false;
  for (const r of reviews) {
    const raw = r.intake?.documentNumber || r.code || "";
    const parsed = parseDocumentNumber(raw);
    if (!parsed) continue;
    const key = seqKey(parsed.companyCode, parsed.year);
    const prev = state[key] || 0;
    if (parsed.seq > prev) {
      state[key] = parsed.seq;
      changed = true;
    }
  }
  if (changed) saveSeqState(state);
}

function nextSeq(companyCode: string, year: string, allocate: boolean): number {
  const code = companyCode.trim().toUpperCase();
  const state = loadSeqState();
  const key = seqKey(code, year);
  const next = (state[key] || 0) + 1;
  if (allocate) {
    state[key] = next;
    saveSeqState(state);
  }
  return next;
}

/** Xem trước số tiếp theo (không tăng STT). */
export function peekDocumentNumber(
  companyCode: string,
  categoryCode: string,
  year = documentNumberYear()
): string {
  if (!companyCode.trim() || !categoryCode.trim()) return "";
  const seq = nextSeq(companyCode, year, false);
  return formatDocumentNumber(
    companyCode.trim().toUpperCase(),
    categoryCode.trim().toUpperCase(),
    year,
    seq
  );
}

/** Cấp số mới và tăng STT theo công ty. */
export function allocateDocumentNumber(
  companyCode: string,
  categoryCode: string,
  year = documentNumberYear()
): string {
  if (!companyCode.trim() || !categoryCode.trim()) {
    throw new Error("Thiếu mã công ty hoặc mã loại hợp đồng để sinh Số tài liệu");
  }
  const seq = nextSeq(companyCode, year, true);
  return formatDocumentNumber(
    companyCode.trim().toUpperCase(),
    categoryCode.trim().toUpperCase(),
    year,
    seq
  );
}
