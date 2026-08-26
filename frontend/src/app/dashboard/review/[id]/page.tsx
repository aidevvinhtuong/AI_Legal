"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ChatPanel } from "@/components/review/chat-panel";
import { AttachmentsPanel } from "@/components/review/attachments-panel";
import { CommentPanel } from "@/components/review/comment-panel";
import { ContractInsightPopup } from "@/components/review/contract-insight-popup";
import { LegalEditsPanel } from "@/components/review/legal-edits-panel";
import { OfflineEditDialog } from "@/components/review/offline-edit-dialog";
import { ReviewedWordView } from "@/components/review/reviewed-word-view";
import type {
  DocSelection,
  SuperDocHandle,
  SuperDocMode,
} from "@/components/review/superdoc-embed";
import { StatusBadge } from "@/components/review/status-badge";
import { useToast } from "@/components/ui/use-toast";
import {
  acceptAllProposals,
  advanceQueue,
  getReviewById,
  getSession,
  sendChat,
  undoAllProposals,
  updateProposalStatus,
  updateReviewedDocument,
  updateReviewedSection,
} from "@/lib/review-service";
import {
  canAccessContractsList,
  canCreateContracts,
  canSuggestEdits,
} from "@/lib/roles";
import type { ContractReview } from "@/lib/types";
import { FileDown, Loader2, Sparkles, Upload } from "lucide-react";
import Link from "next/link";

export default function QuickReviewWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [review, setReview] = useState<ContractReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [insightRecalculating, setInsightRecalculating] = useState(false);
  const [headerInsightOpen, setHeaderInsightOpen] = useState(false);
  const headerBadgeRef = useRef<HTMLButtonElement>(null);
  const [chatPct, setChatPct] = useState(42);
  const [leftTab, setLeftTab] = useState<
    "chat" | "comments" | "edits" | "files"
  >("chat");
  // Handle của SuperDoc: trang cần đọc vùng chọn (neo bình luận TH1) và đọc
  // track changes (gửi đề xuất TH2). Ref chứ không phải state — đổi vùng chọn
  // 60 lần/giây mà render lại cả trang thì không dùng được.
  const superDocRef = useRef<SuperDocHandle>(null);
  const [superDocMode, setSuperDocMode] = useState<SuperDocMode>("viewing");
  const [docSelection, setDocSelection] = useState<DocSelection | null>(null);
  // Chỉ người duyệt mới đề xuất được (TH2). Đọc một lần lúc mount: phiên không
  // đổi giữa chừng, mà `getSession()` chạm localStorage nên không gọi mỗi render.
  const [canSuggest, setCanSuggest] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [offlineOpen, setOfflineOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  const startSplitDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setChatPct(Math.min(70, Math.max(20, pct)));
    };
    const onUp = () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!canCreateContracts(session) && !canAccessContractsList(session)) {
      router.replace("/dashboard");
    }
    setCanSuggest(canSuggestEdits(session));
    setUserId(session?.userId || "");
  }, [router]);

  useEffect(() => {
    getReviewById(params.id)
      .then(setReview)
      .catch((e) => {
        toast({
          title: "Không tải được",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        });
        router.push("/dashboard/review");
      })
      .finally(() => setLoading(false));
  }, [params.id, router, toast]);

  useEffect(() => {
    if (!review) return;
    if (review.status !== "queued" && review.status !== "processing") return;
    const t = setTimeout(async () => {
      const updated = await advanceQueue(review.id);
      setReview(updated);
    }, 1600);
    return () => clearTimeout(t);
  }, [review]);

  if (loading || !review) {
    return (
      <AppLayout lockViewport mainClassName="p-3 pt-14 lg:p-4 lg:pt-4">
        <div className="flex flex-1 items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải workspace...
        </div>
      </AppLayout>
    );
  }

  const isQueueing =
    review.status === "queued" || review.status === "processing";
  const canEdit = ["draft", "reviewed", "awaiting_markers", "rejected"].includes(
    review.status
  );

  return (
    <AppLayout lockViewport mainClassName="p-3 pt-14 lg:p-4 lg:pt-4">
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/review">
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload mới
              </Link>
            </Button>
            {canEdit && !isQueueing && userId === review.ownerId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOfflineOpen(true)}
                title="Tải về, sửa bằng Word, upload lại (PT3)"
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Sửa offline
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-600 shrink-0" />
                <h1 className="text-base font-semibold truncate">
                  {review.title}
                </h1>
                <StatusBadge status={review.status} />
              </div>
              <p className="text-xs text-muted-foreground truncate">
                Chỉ AI review — không Submit duyệt / eContract
                {review.contractTypeLabel
                  ? ` · ${review.contractTypeLabel}`
                  : ""}
                {review.fileName ? ` · ${review.fileName}` : ""}
              </p>
            </div>
          </div>
          {review.contractInsight && (
            <button
              ref={headerBadgeRef}
              type="button"
              className="text-xs rounded-md border px-2 py-1 hover:bg-accent"
              onClick={() => setHeaderInsightOpen(true)}
            >
              AI {review.contractInsight.aiConfidenceScore}% · Fairness{" "}
              {review.contractInsight.fairnessScore}/100
            </button>
          )}
        </div>

        {isQueueing && (
          <div className="shrink-0 flex max-w-md items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">
                {review.status === "queued"
                  ? `Đang chờ AI review${
                      review.queuePosition
                        ? ` (vị trí ~${review.queuePosition})`
                        : ""
                    }`
                  : "AI đang đối chiếu checklist…"}
              </p>
              <Progress
                value={review.status === "queued" ? 35 : 70}
                className="mt-1 h-1.5"
              />
            </div>
          </div>
        )}

        <div
          ref={splitRef}
          className="flex flex-1 min-h-0 flex-col xl:flex-row gap-3 xl:gap-0 overflow-hidden"
        >
          <Card
            style={{ ["--chat-w" as string]: `${chatPct}%` }}
            className="flex flex-col flex-1 xl:flex-none xl:w-[var(--chat-w)] h-full min-h-0 overflow-hidden rounded-xl"
          >
            <CardHeader className="py-2 border-b shrink-0">
              <div className="flex items-center gap-1">
                {(["chat", "comments", "edits", "files"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setLeftTab(tab)}
                    className={
                      leftTab === tab
                        ? "rounded-md bg-muted px-3 py-1.5 text-sm font-medium"
                        : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50"
                    }
                  >
                    {tab === "chat"
                      ? "Chat với AI"
                      : tab === "comments"
                        ? "Bình luận"
                        : tab === "edits"
                          ? "Đề xuất"
                          : "Tệp"}
                  </button>
                ))}
              </div>
              {isQueueing && leftTab === "chat" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Chat mở khi AI xử lý xong — đang xem trước file bên phải.
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
              {leftTab === "chat" && (
                <ChatPanel
                  messages={review.messages}
                  disabled={!canEdit || isQueueing}
                  onSend={async (content) => {
                    setReview(await sendChat(review.id, content));
                  }}
                />
              )}
              {leftTab === "comments" && (
                // Bình luận KHÔNG khoá theo `canEdit`: người duyệt phải bình
                // luận được đúng lúc hợp đồng đang ở hàng chờ của họ — đó mới
                // là lúc cần nói. Phạm vi ai được bình luận do backend quyết.
                <CommentPanel
                  reviewId={review.id}
                  fields={review.fields}
                  canComment
                  documentSelection={docSelection}
                />
              )}
              {leftTab === "edits" && (
                <LegalEditsPanel
                  reviewId={review.id}
                  // Chỉ đọc được track changes khi đang ở chế độ đề xuất —
                  // ngoài chế độ đó thì trong tài liệu không có mark nào.
                  collectSuggestions={
                    superDocMode === "suggesting"
                      ? () => superDocRef.current?.collectSuggestions() ?? []
                      : null
                  }
                  // Áp đề xuất là GHI tài liệu ⇒ chỉ chủ ticket, và chỉ khi
                  // ticket đang ở trạng thái sửa được. Backend chặn lại lần nữa
                  // (`assert_can_edit_document`); đây chỉ để không hiện một nút
                  // mà bấm vào chắc chắn lỗi.
                  canApply={canEdit && !isQueueing && userId === review.ownerId}
                  onReviewUpdated={setReview}
                />
              )}
              {leftTab === "files" && (
                <AttachmentsPanel reviewId={review.id} canAttach />
              )}
            </CardContent>
          </Card>

          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startSplitDrag}
            className="hidden xl:flex shrink-0 w-3 cursor-col-resize items-center justify-center group"
            title="Kéo để chỉnh tỷ lệ hai ngăn"
          >
            <div className="h-16 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
          </div>

          <Card className="flex flex-col flex-1 h-full min-h-0 overflow-hidden p-0 rounded-xl">
            <ReviewedWordView
              fileName={review.fileName}
              title={review.title}
              originalText={review.originalText}
              reviewedText={review.reviewedText || review.originalText}
              proposals={review.proposals}
              canEdit={canEdit && !isQueueing}
              docxUrl={review.reviewedDocxUrl || review.originalDocxUrl}
              attachments={review.attachments}
              contractInsight={review.contractInsight}
              isInsightRecalculating={insightRecalculating}
              superDocRef={superDocRef}
              superDocMode={superDocMode}
              onSuperDocModeChange={
                canSuggest
                  ? (mode) => {
                      // Đổi chế độ là remount tài liệu ⇒ track changes CHƯA GỬI
                      // mất sạch. Người duyệt vừa sửa mười chỗ mà bấm nhầm một
                      // nút thì mất cả buổi, nên phải hỏi trước.
                      if (mode === "viewing") {
                        const unsent =
                          superDocRef.current?.collectSuggestions().length ?? 0;
                        if (
                          unsent > 0 &&
                          !window.confirm(
                            `Còn ${unsent} thay đổi chưa gửi. Thoát chế độ đề xuất sẽ mất hết. Tiếp tục?`
                          )
                        ) {
                          return;
                        }
                      }
                      setSuperDocMode(mode);
                      if (mode === "suggesting") setLeftTab("edits");
                    }
                  : undefined
              }
              onSelectionChange={setDocSelection}
              onAccept={async (proposalId) => {
                setReview(
                  await updateProposalStatus(
                    review.id,
                    proposalId,
                    "accepted"
                  )
                );
                toast({ title: "Đã Accept thay đổi" });
              }}
              onUndo={async (proposalId) => {
                setReview(
                  await updateProposalStatus(review.id, proposalId, "undone")
                );
                toast({ title: "Đã Undo thay đổi" });
              }}
              onAcceptAll={async () => {
                setReview(await acceptAllProposals(review.id));
                toast({ title: "Đã Accept tất cả Loại A" });
              }}
              onUndoAll={async () => {
                setReview(await undoAllProposals(review.id));
                toast({ title: "Đã Undo tất cả" });
              }}
              onDocumentEdit={async (plainText) => {
                setInsightRecalculating(true);
                try {
                  const updated = await updateReviewedDocument(
                    review.id,
                    plainText
                  );
                  setReview(updated);
                  toast({
                    title: "Đã lưu chỉnh sửa trên Word",
                    description: `Độ tin cậy AI: ${updated.contractInsight.aiConfidenceScore}% · Fairness: ${updated.contractInsight.fairnessScore}/100`,
                  });
                } finally {
                  setInsightRecalculating(false);
                }
              }}
              onSectionEdit={async (sectionId, nextBody) => {
                setInsightRecalculating(true);
                try {
                  const idx = Number(sectionId.replace("s_", ""));
                  const updated = await updateReviewedSection(
                    review.id,
                    idx,
                    nextBody
                  );
                  setReview(updated);
                  toast({
                    title: "Đã lưu chỉnh sửa vùng mở",
                    description: `Độ tin cậy AI: ${updated.contractInsight.aiConfidenceScore}% · Fairness: ${updated.contractInsight.fairnessScore}/100`,
                  });
                } finally {
                  setInsightRecalculating(false);
                }
              }}
            />
          </Card>
        </div>
      </div>

      {review.contractInsight && (
        <ContractInsightPopup
          isOpen={headerInsightOpen}
          anchorRef={headerBadgeRef}
          onClose={() => {
            setHeaderInsightOpen(false);
            requestAnimationFrame(() => headerBadgeRef.current?.focus());
          }}
          insight={review.contractInsight}
          isRecalculating={insightRecalculating}
          onJumpToField={() => setHeaderInsightOpen(false)}
        />
      )}
      <OfflineEditDialog
        review={review}
        open={offlineOpen}
        onOpenChange={setOfflineOpen}
        onDone={(updated) => {
          setReview(updated);
          toast({
            title: "Đã nhận bản sửa offline",
            description: `Vòng review mới — v${updated.version}, AI đang chạy lại.`,
          });
        }}
      />
    </AppLayout>
  );
}
