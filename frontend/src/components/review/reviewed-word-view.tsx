"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WordEmbedShell } from "@/components/review/word-embed";
import { DocxEmbed } from "@/components/review/docx-embed";
import {
  SuperDocEmbed,
  type DocSelection,
  type SuperDocHandle,
  type SuperDocMode,
} from "@/components/review/superdoc-embed";
import { DOCX_RENDERER } from "@/lib/api";
import { parseContractSections } from "@/components/review/original-word-view";
import { ContractInsightPopup } from "@/components/review/contract-insight-popup";
import type {
  AiProposal,
  ContractInsight,
  ReviewAttachment,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, PenLine, RotateCcw } from "lucide-react";

/**
 * Màn AI-reviewed chính: nhúng Word preview + Accept/Undo đề xuất trên file.
 */
export function ReviewedWordView({
  fileName,
  title,
  originalText,
  reviewedText,
  proposals,
  canEdit,
  docxUrl,
  attachments,
  onAccept,
  onUndo,
  onAcceptAll,
  onUndoAll,
  contractInsight,
  isInsightRecalculating,
  onDocumentEdit,
  onSectionEdit,
  superDocRef,
  superDocMode = "viewing",
  onSuperDocModeChange,
  onSelectionChange,
}: {
  fileName: string;
  title?: string;
  originalText: string;
  reviewedText: string;
  proposals: AiProposal[];
  canEdit?: boolean;
  docxUrl?: string;
  attachments?: ReviewAttachment[];
  onAccept: (proposalId: string) => void;
  onUndo: (proposalId: string) => void;
  onAcceptAll: () => void;
  onUndoAll: () => void;
  contractInsight?: ContractInsight;
  isInsightRecalculating?: boolean;
  onDocumentEdit?: (plainText: string) => void;
  onSectionEdit?: (sectionId: string, nextBody: string) => void;
  /** Handle của SuperDoc — cha dùng để đọc vùng chọn và track changes. */
  superDocRef?: React.Ref<SuperDocHandle>;
  superDocMode?: SuperDocMode;
  /** Có hàm này thì hiện nút bật/tắt chế độ đề xuất (TH2). */
  onSuperDocModeChange?: (mode: SuperDocMode) => void;
  onSelectionChange?: (selection: DocSelection | null) => void;
}) {
  const fileTabs = useMemo<ReviewAttachment[]>(() => {
    if (attachments?.length) return attachments;
    return [
      {
        id: "primary",
        fileName,
        reviewedDocxUrl: docxUrl,
        originalDocxUrl: docxUrl,
        originalText,
        reviewedText,
      },
    ];
  }, [attachments, fileName, docxUrl, originalText, reviewedText]);

  const [activeFileId, setActiveFileId] = useState(fileTabs[0]?.id || "primary");
  const [insightOpen, setInsightOpen] = useState(false);
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);
  const [scrollToDocProposalId, setScrollToDocProposalId] = useState<
    string | null
  >(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!fileTabs.some((f) => f.id === activeFileId)) {
      setActiveFileId(fileTabs[0]?.id || "primary");
    }
  }, [fileTabs, activeFileId]);

  const activeFile =
    fileTabs.find((f) => f.id === activeFileId) || fileTabs[0];
  const activeDocxUrl =
    activeFile?.reviewedDocxUrl ||
    activeFile?.originalDocxUrl ||
    (activeFileId === fileTabs[0]?.id ? docxUrl : undefined);

  const activeOriginal =
    activeFile?.originalText ||
    (activeFileId === fileTabs[0]?.id ? originalText : "");
  const activeReviewed =
    activeFile?.reviewedText ||
    activeFile?.originalText ||
    (activeFileId === fileTabs[0]?.id
      ? reviewedText || originalText
      : "(Chưa có nội dung preview riêng cho file này.)");

  const pendingTypeA = proposals.filter(
    (p) => p.kind === "A" && p.status === "pending"
  );
  const acceptedTypeA = proposals.filter(
    (p) => p.kind === "A" && p.status === "accepted"
  );

  const originalSections = parseContractSections(activeOriginal || originalText);
  const reviewedSections = parseContractSections(
    activeReviewed || reviewedText || originalText
  );

  const score = contractInsight?.aiConfidenceScore ?? 0;
  const isPrimaryFile = activeFileId === fileTabs[0]?.id;

  useEffect(() => {
    if (!highlightFieldId) return;
    const byField = proposals.find((p) => p.fieldId === highlightFieldId);
    setScrollToDocProposalId(byField?.id || highlightFieldId);
    const t = setTimeout(() => setHighlightFieldId(null), 2200);
    return () => clearTimeout(t);
  }, [highlightFieldId, proposals]);

  const handleCloseInsight = () => {
    setInsightOpen(false);
    requestAnimationFrame(() => badgeRef.current?.focus());
  };

  const toolbar = (
    <>
      <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
        {title || "AI-reviewed"}
        {fileTabs.length > 1 && (
          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
            ({fileTabs.findIndex((f) => f.id === activeFileId) + 1}/{fileTabs.length})
          </span>
        )}
      </span>
      {/* Trình hiển thị đang chạy. Có nhãn thì không phải mở DevTools để đoán
          xem `NEXT_PUBLIC_EDITOR` đã ăn chưa — và SuperDoc thì mất lớp diff
          của AI trên file, nên người dùng cần biết vì sao nút Accept trên
          trang không còn. */}
      <span
        title={
          DOCX_RENDERER === "superdoc"
            ? "SuperDoc — chỉ hiển thị. Accept/Undo đề xuất làm ở panel bên phải."
            : "docx-preview — có lớp diff Accept/Undo ngay trên tài liệu."
        }
        className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-muted text-muted-foreground"
      >
        {DOCX_RENDERER === "superdoc" ? "SuperDoc" : "docx-preview"}
      </span>
      {onSuperDocModeChange && DOCX_RENDERER === "superdoc" && (
        <Button
          size="sm"
          variant={superDocMode === "suggesting" ? "default" : "outline"}
          className="h-7 text-[11px]"
          onClick={() =>
            onSuperDocModeChange(
              superDocMode === "suggesting" ? "viewing" : "suggesting"
            )
          }
          title={
            superDocMode === "suggesting"
              ? "Đang ở chế độ đề xuất — mọi thay đổi ghi thành track changes, chưa vào tài liệu"
              : "Bật chế độ đề xuất để sửa trực tiếp dưới dạng track changes"
          }
        >
          <PenLine className="mr-1 h-3 w-3" />
          {superDocMode === "suggesting" ? "Đang đề xuất" : "Đề xuất sửa"}
        </Button>
      )}
      {contractInsight ? (
        <button
          ref={badgeRef}
          type="button"
          onClick={() => setInsightOpen((v) => !v)}
          className={cn(
            "text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors",
            "bg-[#E8F0F7] text-[#1F4E79] border-[#1F4E79]/40 hover:bg-[#d6e6f3]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4E79]"
          )}
          aria-haspopup="dialog"
          aria-expanded={insightOpen}
        >
          <span className="font-semibold">{score}%</span>
          <span className="ml-1 font-normal opacity-80">tin cậy</span>
        </button>
      ) : (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
          {score}% tin cậy
        </span>
      )}
      <div className="flex-1" />
      {canEdit && isPrimaryFile && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={pendingTypeA.length === 0}
            onClick={onAcceptAll}
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Accept tất cả ({pendingTypeA.length})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={acceptedTypeA.length === 0}
            onClick={onUndoAll}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Undo tất cả
          </Button>
        </>
      )}
    </>
  );

  const displayName = (
    activeFile?.fileName || fileName
  ).replace(/\.docx$/i, "") + "_reviewed.docx";

  return (
    <>
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <WordEmbedShell
          fileName={displayName}
          files={fileTabs.map((f) => ({
            id: f.id,
            label: f.fileName.replace(/\.docx$/i, "") + "_reviewed.docx",
          }))}
          activeFileId={activeFileId}
          onFileChange={setActiveFileId}
          toolbar={toolbar}
          className="flex-1 min-h-0"
        >
          {activeDocxUrl && DOCX_RENDERER === "superdoc" ? (
            // Lớp diff của AI chưa port sang SuperDoc, nên accept/undo đề xuất
            // AI vẫn thao tác ở panel bên cạnh. Đổi lại: độ trung thực cao hơn,
            // bôi chọn được để neo bình luận (TH1), và sửa được ở chế độ đề
            // xuất để sinh track changes (TH2).
            <SuperDocEmbed
              key={`${activeFileId}:${superDocMode}`}
              ref={superDocRef}
              src={activeDocxUrl}
              mode={superDocMode}
              onSelectionChange={onSelectionChange}
            />
          ) : activeDocxUrl ? (
            <DocxEmbed
              key={activeFileId}
              src={activeDocxUrl}
              editable={false}
              canEditDiff={!!canEdit && isPrimaryFile}
              onAcceptProposal={onAccept}
              onUndoProposal={onUndo}
              diffProposals={
                isPrimaryFile
                  ? proposals.map((p) => ({
                      id: p.id,
                      kind: p.kind,
                      originalText: p.originalText,
                      proposedText: p.proposedText,
                      status: p.status,
                    }))
                  : undefined
              }
              scrollToProposalId={scrollToDocProposalId}
              onScrolledToProposal={() => setScrollToDocProposalId(null)}
            />
          ) : (
            <EditableFallback
              sections={reviewedSections}
              originalSections={originalSections}
              proposals={isPrimaryFile ? proposals : []}
              canEdit={false}
              onSectionEdit={undefined}
              onAccept={onAccept}
              onUndo={onUndo}
            />
          )}
        </WordEmbedShell>
      </div>

      {contractInsight && (
        <ContractInsightPopup
          isOpen={insightOpen}
          anchorRef={badgeRef}
          onClose={handleCloseInsight}
          insight={contractInsight}
          isRecalculating={isInsightRecalculating}
          onJumpToField={(fieldId) => {
            setHighlightFieldId(fieldId);
            setInsightOpen(false);
            requestAnimationFrame(() => badgeRef.current?.focus());
          }}
        />
      )}
    </>
  );
}

/** Fallback khi chưa có .docx — vẫn cho edit section. */
function EditableFallback({
  sections,
  originalSections,
  proposals,
  canEdit,
  onSectionEdit,
  onAccept,
  onUndo,
}: {
  sections: ReturnType<typeof parseContractSections>;
  originalSections: ReturnType<typeof parseContractSections>;
  proposals: AiProposal[];
  canEdit?: boolean;
  onSectionEdit?: (sectionId: string, nextBody: string) => void;
  onAccept: (id: string) => void;
  onUndo: (id: string) => void;
}) {
  return (
    <div className="font-['Times_New_Roman',Times,serif] text-[14px] leading-[1.65] px-2 py-2">
      <div>
        {sections.map((section, idx) => {
          const orig = originalSections[idx] || { id: section.id, body: "" };
          const proposal = proposals.find(
            (p) =>
              (orig.body + (orig.heading || "")).includes(p.originalText) ||
              (section.body + (section.heading || "")).includes(p.proposedText)
          );
          const locked = section.locked || proposal?.kind === "B";
          return (
            <div key={section.id} className="mb-4 relative group">
              {section.heading && (
                <h2 className="font-bold uppercase mb-1">{section.heading}</h2>
              )}
              {locked ? (
                <p className="whitespace-pre-wrap text-justify">{section.body}</p>
              ) : (
                <p
                  className={cn(
                    "whitespace-pre-wrap text-justify rounded-sm px-1 -mx-1 min-h-[1.5em]",
                    canEdit &&
                      "border border-transparent hover:border-sky-300 focus:border-sky-400 focus:bg-sky-50/50 focus:outline-none"
                  )}
                  contentEditable={!!canEdit}
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    if (!canEdit || !onSectionEdit) return;
                    const text = (e.currentTarget.textContent || "").replace(
                      /\u00a0/g,
                      " "
                    );
                    if (text !== section.body) onSectionEdit(section.id, text);
                  }}
                >
                  {section.body}
                </p>
              )}
              {proposal?.kind === "A" && canEdit && (
                <div className="mt-1 flex gap-1">
                  {proposal.status !== "accepted" ? (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onAccept(proposal.id)}
                    >
                      Accept
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onUndo(proposal.id)}
                    >
                      Undo
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
