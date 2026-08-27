"use client";

import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { Loader2 } from "lucide-react";
import { fetchBinary } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  applyDocxInlineDiffs,
  scrollToDocxDiff,
  type InlineDiffProposal,
} from "@/lib/docx/inline-diff";

/**
 * Nhúng .docx bằng docx-preview (preview-only).
 * diffProposals → 2 dòng đỏ/xanh + Accept/Undo dưới dòng xanh.
 */
export function DocxEmbed({
  src,
  className,
  editable = false,
  fieldRestricted = false,
  onEditCommit,
  diffProposals,
  canEditDiff = false,
  onAcceptProposal,
  onUndoProposal,
  scrollToProposalId,
  onScrolledToProposal,
}: {
  src: string;
  className?: string;
  editable?: boolean;
  fieldRestricted?: boolean;
  onEditCommit?: (plainText: string, html: string) => void;
  diffProposals?: InlineDiffProposal[];
  canEditDiff?: boolean;
  onAcceptProposal?: (proposalId: string) => void;
  onUndoProposal?: (proposalId: string) => void;
  scrollToProposalId?: string | null;
  onScrolledToProposal?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<string>("");
  const plainSnapshotRef = useRef<string>("");
  const acceptRef = useRef(onAcceptProposal);
  const undoRef = useRef(onUndoProposal);
  acceptRef.current = onAcceptProposal;
  undoRef.current = onUndoProposal;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffCount, setDiffCount] = useState(0);

  const diffKey = JSON.stringify({
    items: diffProposals ?? [],
    canEditDiff,
  });

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host || !src) return;

    setLoading(true);
    setError(null);
    setDiffCount(0);
    host.innerHTML = "";
    snapshotRef.current = "";

    (async () => {
      try {
        // Link file đi qua endpoint kiểm quyền của backend, KHÔNG phải
        // presigned URL trần — nên phải gửi kèm Bearer token.
        const buf = await fetchBinary(src);
        if (cancelled) return;
        await renderAsync(buf, host, undefined, {
          className: "docx-preview-body",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
        });
        if (cancelled) return;

        const editableRoot =
          (host.querySelector(".docx-wrapper") as HTMLElement | null) || host;
        plainSnapshotRef.current = editableRoot.innerText || "";
        snapshotRef.current = host.innerHTML;

        const allowDocEdit = editable && !fieldRestricted;
        if (allowDocEdit) {
          editableRoot.contentEditable = "true";
          editableRoot.spellcheck = true;
          editableRoot.classList.add("docx-editable-root");
        } else {
          editableRoot.contentEditable = "false";
          editableRoot.classList.remove("docx-editable-root");
        }

        if (diffProposals?.length) {
          setDiffCount(
            applyDocxInlineDiffs(host, diffProposals, { canEdit: canEditDiff })
          );
        }

        setLoading(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Lỗi render docx";
        if (!cancelled) {
          setError(msg);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, editable, fieldRestricted]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || loading || error || !snapshotRef.current) return;
    host.innerHTML = snapshotRef.current;
    if (!diffProposals?.length) {
      setDiffCount(0);
      return;
    }
    setDiffCount(
      applyDocxInlineDiffs(host, diffProposals, { canEdit: canEditDiff })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, diffKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !scrollToProposalId || loading) return;
    const ok = scrollToDocxDiff(host, scrollToProposalId);
    if (ok) onScrolledToProposal?.();
  }, [scrollToProposalId, loading, diffCount, onScrolledToProposal]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const btn = t?.closest?.("[data-diff-action]") as HTMLElement | null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.proposalId;
      const action = btn.dataset.diffAction;
      if (!id) return;
      if (action === "accept") acceptRef.current?.(id);
      if (action === "undo") undoRef.current?.(id);
    };
    host.addEventListener("click", onClick);
    return () => host.removeEventListener("click", onClick);
  }, [loading, diffCount]);

  const handleBlur = () => {
    if (!editable || fieldRestricted || !onEditCommit) return;
    const host = hostRef.current;
    if (!host) return;
    const editableRoot =
      (host.querySelector(".docx-wrapper") as HTMLElement | null) || host;
    const plain = editableRoot.innerText || "";
    if (plain === plainSnapshotRef.current) return;
    plainSnapshotRef.current = plain;
    onEditCommit(plain, editableRoot.innerHTML);
  };

  return (
    <div
      className={cn("relative h-full min-h-0 overflow-auto bg-[#f3f3f3]", className)}
      onBlur={handleBlur}
    >
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#f3f3f3]/80 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải Word…
        </div>
      )}
      {error && (
        <div className="p-4 text-sm text-destructive bg-destructive/5 border border-destructive/20 m-4 rounded-md">
          {error}
        </div>
      )}
      <div
        ref={hostRef}
        className={cn(
          "docx-embed-host px-2 py-4",
          "[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-2",
          "[&_section.docx]:!shadow-md [&_section.docx]:!mb-4",
          editable &&
            !fieldRestricted &&
            "[&_.docx-editable-root]:outline-none [&_.docx-editable-root]:ring-2 [&_.docx-editable-root]:ring-sky-200/80 [&_.docx-editable-root]:rounded-sm"
        )}
      />
      {!loading && !error && (diffProposals?.length ?? 0) > 0 && (
        <p className="sticky bottom-0 text-center text-[11px] text-slate-700 bg-white/95 border-t px-2 py-1.5">
          Diff trên file: dòng đỏ = cũ · dòng xanh = mới
          {diffCount > 0
            ? ` — đã gắn ${diffCount}/${diffProposals!.length} đề xuất`
            : " — chưa khớp đoạn nào trong file"}
        </p>
      )}
    </div>
  );
}
