export type InlineDiffProposal = {
  id: string;
  kind: "A" | "B";
  originalText: string;
  proposedText: string;
  status: "pending" | "accepted" | "undone" | "annotation";
};

export type ApplyInlineDiffOptions = {
  /** Hiện Accept / Undo dưới dòng xanh (Loại A) */
  canEdit?: boolean;
};

type TextPiece = { node: Text; start: number; end: number };

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chuẩn hoá NFC + gom whitespace — giúp khớp text Word bị tách run. */
export function normalizeSearchText(s: string) {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function collectTextPieces(root: HTMLElement): { full: string; pieces: TextPiece[] } {
  const pieces: TextPiece[] = [];
  let full = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const data = node.data.normalize("NFC");
    if (data !== node.data) node.data = data;
    if (data.length > 0) {
      pieces.push({ node, start: full.length, end: full.length + data.length });
      full += data;
    }
    node = walker.nextNode() as Text | null;
  }
  return { full, pieces };
}

function findFlexibleRange(
  haystack: string,
  needle: string
): { start: number; end: number } | null {
  const tokens = normalizeSearchText(needle).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const re = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "u");
  const m = re.exec(haystack);
  if (!m || m.index == null) return null;
  return { start: m.index, end: m.index + m[0].length };
}

function rangeFromOffset(
  pieces: TextPiece[],
  start: number,
  end: number
): Range | null {
  if (end <= start) return null;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const p of pieces) {
    if (!startNode && start >= p.start && start < p.end) {
      startNode = p.node;
      startOffset = start - p.start;
    }
    if (end > p.start && end <= p.end) {
      endNode = p.node;
      endOffset = end - p.start;
      break;
    }
    if (end > p.end && p.end > start) {
      endNode = p.node;
      endOffset = p.node.data.length;
    }
  }

  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

function makeActionButton(
  proposalId: string,
  action: "accept" | "undo",
  label: string
) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    action === "accept"
      ? "docx-diff-btn docx-diff-btn-accept"
      : "docx-diff-btn docx-diff-btn-undo";
  btn.dataset.diffAction = action;
  btn.dataset.proposalId = proposalId;
  btn.textContent = label;
  return btn;
}

/**
 * Diff dạng 2 dòng: dòng cũ (đỏ + gạch) → dòng mới (xanh) + Accept/Undo.
 * Dù chỉ đổi 1 chữ cũng hiển thị cả đoạn original / proposed.
 */
function buildDiffFragment(
  proposal: InlineDiffProposal,
  matchedOriginal: string,
  options?: ApplyInlineDiffOptions
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const wrap = document.createElement("span");
  wrap.className = "docx-diff docx-diff-block";
  wrap.dataset.proposalId = proposal.id;
  wrap.dataset.kind = proposal.kind;
  wrap.dataset.status = proposal.status;

  const showAsAccepted = proposal.status === "accepted";
  const isAnnotation = proposal.status === "annotation" || proposal.kind === "B";
  const ann = isAnnotation ? " docx-diff-annotation" : "";

  if (!showAsAccepted) {
    const del = document.createElement("span");
    del.className = `docx-diff-del docx-diff-line${ann}`;
    del.textContent = matchedOriginal;
    wrap.appendChild(del);
  }

  const insWrap = document.createElement("span");
  insWrap.className = "docx-diff-ins-wrap";

  const ins = document.createElement("span");
  ins.className = `docx-diff-ins docx-diff-line${ann}`;
  ins.textContent = proposal.proposedText;
  insWrap.appendChild(ins);

  if (proposal.kind === "A" && options?.canEdit) {
    const actions = document.createElement("span");
    actions.className = "docx-diff-actions";
    if (showAsAccepted) {
      actions.appendChild(makeActionButton(proposal.id, "undo", "Undo"));
    } else {
      actions.appendChild(makeActionButton(proposal.id, "accept", "Accept"));
    }
    insWrap.appendChild(actions);
  } else if (isAnnotation) {
    const tag = document.createElement("span");
    tag.className = "docx-diff-lock-tag";
    tag.textContent = "Loại B — vùng khóa";
    insWrap.appendChild(tag);
  }

  wrap.appendChild(insWrap);
  frag.appendChild(wrap);
  return frag;
}

/**
 * Gắn diff 2 dòng (đỏ gạch / xanh thêm) lên DOM docx-preview.
 * Caller restore HTML snapshot trước khi gọi lại.
 */
export function applyDocxInlineDiffs(
  root: HTMLElement,
  proposals: InlineDiffProposal[],
  options?: ApplyInlineDiffOptions
): number {
  const active = proposals.filter(
    (p) =>
      p.status === "pending" ||
      p.status === "accepted" ||
      p.status === "annotation"
  );
  const ordered = [...active].sort(
    (a, b) =>
      normalizeSearchText(b.originalText).length -
      normalizeSearchText(a.originalText).length
  );

  const { full, pieces } = collectTextPieces(root);
  if (!full) return 0;

  type Hit = {
    proposal: InlineDiffProposal;
    start: number;
    end: number;
    matched: string;
  };
  const hits: Hit[] = [];
  const occupied: { start: number; end: number }[] = [];

  for (const proposal of ordered) {
    if (!proposal.originalText?.trim()) continue;
    const rangePos = findFlexibleRange(full, proposal.originalText);
    if (!rangePos) continue;
    if (occupied.some((o) => rangePos.start < o.end && rangePos.end > o.start)) {
      continue;
    }
    hits.push({
      proposal,
      start: rangePos.start,
      end: rangePos.end,
      matched: full.slice(rangePos.start, rangePos.end),
    });
    occupied.push(rangePos);
  }

  hits.sort((a, b) => b.start - a.start);
  let applied = 0;
  for (const hit of hits) {
    const range = rangeFromOffset(pieces, hit.start, hit.end);
    if (!range) continue;
    try {
      range.deleteContents();
      range.insertNode(buildDiffFragment(hit.proposal, hit.matched, options));
      applied += 1;
    } catch {
      // DOM Word phức tạp — bỏ qua
    }
  }

  return applied;
}

export function scrollToDocxDiff(root: HTMLElement, proposalId: string) {
  const el = root.querySelector(
    `.docx-diff[data-proposal-id="${CSS.escape(proposalId)}"]`
  ) as HTMLElement | null;
  if (!el) return false;
  el.classList.add("docx-diff-flash");
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => el.classList.remove("docx-diff-flash"), 1600);
  return true;
}
