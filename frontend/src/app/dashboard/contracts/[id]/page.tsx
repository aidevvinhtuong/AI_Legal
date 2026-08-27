"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/review/status-badge";
import { ChatPanel } from "@/components/review/chat-panel";
import { ContractInsightPopup } from "@/components/review/contract-insight-popup";
import { OfflineEditDialog } from "@/components/review/offline-edit-dialog";
import { ReviewedWordView } from "@/components/review/reviewed-word-view";
import {
  IntakeFormFields,
  buildIntakeMeta,
  intakeFromReview,
  isIntakeFormValid,
  type IntakeFormValue,
} from "@/components/review/intake-form-fields";
import { useToast } from "@/components/ui/use-toast";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/domain/form-lists";
import { getSession } from "@/lib/auth/session";
import { isInFlight, useReviewStatus } from "@/lib/hooks/use-review-status";
import {
  acceptAllProposals,
  getReviewById,
  listBusinessEntities,
  listContractBases,
  listContractNames,
  listContractTypes,
  listDiscountOptions,
  listDocumentCategories,
  sendChat,
  submitDraftToQueue,
  submitToLegal,
  undoAllProposals,
  updateProposalStatus,
  updateReviewIntake,
  updateReviewedDocument,
  updateReviewedSection,
} from "@/lib/services/reviews";
import { isLegalLike } from "@/lib/domain/roles";
import type {
  ContractReview,
  ContractTypeConfig,
  ContractVersionEntry,
  DocumentCategory,
} from "@/lib/domain/types";
import {
  CheckSquare,
  Download,
  FileText,
  FileUp,
  History,
  Loader2,
  Save,
  Send,
  Sparkles,
} from "lucide-react";

function formatVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [review, setReview] = useState<ContractReview | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [isLegal, setIsLegal] = useState(false);
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [types, setTypes] = useState<ContractTypeConfig[]>([]);
  const [discountOptions, setDiscountOptions] = useState<DiscountOption[]>([]);
  const [businessEntities, setBusinessEntities] = useState<CodeLabelOption[]>(
    []
  );
  const [contractBases, setContractBases] = useState<CodeLabelOption[]>([]);
  const [contractNames, setContractNames] = useState<ContractNameOption[]>([]);
  const [intakeForm, setIntakeForm] = useState<IntakeFormValue | null>(null);
  const [headerInsightOpen, setHeaderInsightOpen] = useState(false);
  const [insightRecalculating, setInsightRecalculating] = useState(false);
  /** null = đang xem bản hiện tại; number = xem lại snapshot version cũ */
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const headerBadgeRef = useRef<HTMLButtonElement>(null);

  /** % chiều rộng cột Chat trong tab Workspace (kéo thanh chia để đổi). */
  const [chatPct, setChatPct] = useState(42);
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
    setViewVersion(null);
  }, [review?.version, params.id]);

  useEffect(() => {
    setIsLegal(isLegalLike(getSession()?.role));
  }, []);

  useEffect(() => {
    Promise.all([
      listDocumentCategories(),
      listContractTypes(),
      listDiscountOptions(),
      listBusinessEntities(),
      listContractBases(),
      listContractNames(),
    ]).then(([cats, t, discounts, entities, bases, names]) => {
      setCategories(cats);
      setTypes(t);
      setDiscountOptions(discounts);
      setBusinessEntities(entities);
      setContractBases(bases);
      setContractNames(names);
    });
  }, []);

  const refresh = useCallback(async () => {
    const data = await getReviewById(params.id);
    setReview(data);
    setIntakeForm(intakeFromReview(data));
    return data;
  }, [params.id]);

  useEffect(() => {
    refresh()
      .catch((e) => {
        toast({
          title: "Không tải được",
          description: e instanceof Error ? e.message : "Lỗi",
          variant: "destructive",
        });
        router.push("/dashboard");
      })
      .finally(() => setLoading(false));
  }, [refresh, router, toast]);

  /**
   * Theo dõi tiến độ AI bằng SSE (lùi về poll `/status` nếu SSE hỏng).
   *
   * Chỉ tải lại bản đầy đủ **một lần** lúc job xong, thay vì mỗi 1,6 giây như
   * trước — `GET /reviews/{id}` kéo theo cả `fields`, `proposals`, `messages`.
   */
  const { event: liveStatus, degraded: statusDegraded } = useReviewStatus(
    review?.id,
    review?.status,
    useCallback(() => {
      void refresh().catch(() => {
        // Lỗi tải lại đã có `refresh` xử lý ở đường chính; ở đây nuốt để một
        // lần mạng chập không ném unhandled rejection.
      });
    }, [refresh])
  );

  if (loading || !review || !intakeForm) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
        </div>
      </AppLayout>
    );
  }

  const isDraft = review.status === "draft";
  const canEdit =
    !isLegal &&
    ["draft", "reviewed", "awaiting_markers", "rejected"].includes(review.status);
  /** Sau Submit + AI review: luôn mở Chat + preview (không chờ hết queue). */
  const showWorkspace = !isDraft;
  // Trạng thái từ SSE mới hơn bản review đang giữ trong state — ưu tiên nó để
  // banner tiến độ không trễ một nhịp so với thực tế.
  const displayStatus = liveStatus?.status ?? review.status;
  const isQueueing = isInFlight(displayStatus);
  const queuePos = liveStatus?.queuePosition ?? review.queuePosition;
  const queueLabel =
    displayStatus === "queued"
      ? `Đang chờ AI review${queuePos ? ` (vị trí ~${queuePos})` : ""}`
      : displayStatus === "syncing_econtract"
        ? "Đang đẩy sang FPT.eContract…"
        : "AI đang đối chiếu checklist…";
  const defaultMainTab = isDraft ? "info" : "ai-review";
  const versionHistory: ContractVersionEntry[] = review.versionHistory || [];
  const viewingVersionEntry =
    viewVersion !== null
      ? versionHistory.find((e) => e.version === viewVersion) || null
      : null;

  const handleSaveIntake = async () => {
    if (!isIntakeFormValid(intakeForm)) {
      toast({
        title: "Thiếu thông tin",
        description: "Điền đủ các trường bắt buộc trước khi lưu.",
        variant: "destructive",
      });
      return;
    }
    const intake = buildIntakeMeta(
      intakeForm,
      categories,
      businessEntities,
      contractBases,
      contractNames
    );
    if (!intake) {
      toast({
        title: "Loại hợp đồng (Contract category) không hợp lệ",
        variant: "destructive",
      });
      return;
    }
    setSavingIntake(true);
    try {
      const updated = await updateReviewIntake(
        review.id,
        {
          intake,
          contractTypeId: intakeForm.contractTypeId,
          prompt: intakeForm.prompt,
        },
        review.rowVersion
      );
      setReview(updated);
      setIntakeForm(intakeFromReview(updated));
      toast({ title: "Đã lưu thông tin hợp đồng" });
    } catch (e) {
      toast({
        title: "Không lưu được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSavingIntake(false);
    }
  };

  const handleDownload = () => {
    const docxUrl = review.reviewedDocxUrl || review.originalDocxUrl;
    if (docxUrl) {
      const a = document.createElement("a");
      a.href = docxUrl;
      a.download = review.fileName || "contract.docx";
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
      toast({ title: "Đang tải .docx" });
      return;
    }
    const blob = new Blob([review.reviewedText || review.originalText], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = review.fileName.replace(/\.docx$/i, "") + "_reviewed.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Demo export",
      description: "Không có .docx — xuất text tạm.",
    });
  };

  const handleSubmitLegal = async () => {
    setSubmitting(true);
    try {
      const updated = await submitToLegal(review.id);
      setReview(updated);
      toast({ title: "Đã gửi Legal duyệt" });
    } catch (e) {
      toast({
        title: "Không gửi được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAi = async () => {
    setSubmitting(true);
    try {
      if (canEdit && isIntakeFormValid(intakeForm)) {
        const intake = buildIntakeMeta(
          intakeForm,
          categories,
          businessEntities,
          contractBases,
          contractNames
        );
        if (intake) {
          await updateReviewIntake(
            review.id,
            {
              intake,
              contractTypeId: intakeForm.contractTypeId,
              prompt: intakeForm.prompt,
            },
            review.rowVersion
          );
        }
      }
      const updated = await submitDraftToQueue(review.id);
      setReview(updated);
      setIntakeForm(intakeFromReview(updated));
      toast({ title: "Đã gửi AI review", description: "Yêu cầu vào Processing Queue." });
    } catch (e) {
      toast({
        title: "Không gửi được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout
      lockViewport
      mainClassName="p-3 pt-14 lg:p-4 lg:pt-4"
    >
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{review.code}</h1>
              <StatusBadge status={review.status} />
              <span className="text-sm text-muted-foreground">v{review.version}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {review.title} · {review.contractTypeLabel} ·{" "}
              {review.fileName}
              {review.intake?.documentCategoryLabel
                ? ` · ${review.intake.documentCategoryLabel}`
                : ""}
              {review.intake?.contractValue
                ? ` · GT: ${review.intake.contractValue}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showWorkspace && !isDraft && review.contractInsight && (
              <button
                ref={headerBadgeRef}
                type="button"
                onClick={() => setHeaderInsightOpen((v) => !v)}
                className="inline-flex h-9 items-center rounded-md border border-[#1F4E79]/35 bg-[#E8F0F7] px-3 text-sm font-semibold text-[#1F4E79] hover:bg-[#d6e6f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F4E79]"
                aria-haspopup="dialog"
                aria-expanded={headerInsightOpen}
              >
                {review.contractInsight.aiConfidenceScore}% tin cậy
              </button>
            )}
            <Button variant="outline" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-2" />
              Tải file .docx
            </Button>
            {canEdit && !isQueueing && (
              <Button
                variant="outline"
                onClick={() => setOfflineOpen(true)}
                title="Tải về, sửa bằng Word, upload lại (PT3)"
              >
                <FileUp className="h-4 w-4 mr-2" />
                Sửa offline
              </Button>
            )}
            {canEdit && isDraft && (
              <Button
                onClick={handleSubmitAi}
                disabled={submitting}
                title="Khi file HĐ đã chỉnh sửa xong"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Gửi AI review
              </Button>
            )}
            {canEdit && !isDraft && (
              <Button onClick={handleSubmitLegal} disabled={submitting}>
                {submitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Gửi duyệt
              </Button>
            )}
            {review.status === "pending_markers" && (
              <Button asChild>
                <a href={`/dashboard/contracts/${review.id}/identify-signers`}>
                  Gán chữ ký
                </a>
              </Button>
            )}
            {isLegal && review.status === "pending_legal" && (
              <Button asChild>
                <a href={`/dashboard/tasks?focus=${review.id}`}>Mở Task</a>
              </Button>
            )}
          </div>
        </div>

        {review.feedback.length > 0 && (
          <Card className="shrink-0 border-destructive/30 rounded-xl max-h-28 overflow-y-auto">
            <CardHeader className="pb-2 py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckSquare className="h-4 w-4" />
                Checklist việc cần sửa (Structured Feedback từ Legal)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 pb-3">
              {review.feedback.map((f) => (
                <div key={f.id} className="rounded-xl border px-3 py-2 text-sm">
                  <div className="font-medium">{f.clauseLabel}</div>
                  <p className="text-muted-foreground">{f.comment}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Tabs
          defaultValue={defaultMainTab}
          key={defaultMainTab}
          className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden"
        >
          <TabsList className="h-10 shrink-0 self-start">
            <TabsTrigger value="info" className="gap-1.5 px-4">
              <FileText className="h-3.5 w-3.5" />
              Thông tin hợp đồng
            </TabsTrigger>
            <TabsTrigger value="ai-review" className="gap-1.5 px-4">
              <Sparkles className="h-3.5 w-3.5" />
              AI Workspace
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="info"
            className="mt-0 flex-1 min-h-0 overflow-y-auto space-y-4 data-[state=inactive]:hidden"
          >
            <Card className="rounded-xl border-sky-200 bg-sky-50/50">
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {isDraft
                      ? "Nháp — chỉnh sửa thông tin · file đang hoàn thiện"
                      : "Thông tin hợp đồng"}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {canEdit
                      ? "Có thể chỉnh sửa các trường bên dưới. Các trường đánh dấu * là bắt buộc."
                      : "Chỉ xem — không có quyền chỉnh sửa."}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    onClick={handleSaveIntake}
                    disabled={savingIntake}
                    className="shrink-0"
                  >
                    {savingIntake ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Lưu thông tin
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <IntakeFormFields
                  value={intakeForm}
                  onChange={setIntakeForm}
                  categories={categories}
                  types={types}
                  discountOptions={discountOptions}
                  businessEntities={businessEntities}
                  contractBases={contractBases}
                  contractNames={contractNames}
                  disabled={!canEdit}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="ai-review"
            className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            {showWorkspace && (
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {versionHistory.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <History className="h-3.5 w-3.5 text-muted-foreground" />
                        <Select
                          value={
                            viewVersion === null ? "current" : String(viewVersion)
                          }
                          onValueChange={(v) =>
                            setViewVersion(v === "current" ? null : Number(v))
                          }
                        >
                          <SelectTrigger className="h-8 w-[300px] text-xs">
                            <SelectValue placeholder="Chọn version" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">
                              Bản hiện tại (v{review.version})
                            </SelectItem>
                            {[...versionHistory]
                              .sort((a, b) => b.version - a.version)
                              .map((e) => (
                                <SelectItem
                                  key={e.version}
                                  value={String(e.version)}
                                >
                                  v{e.version} · {e.label} ·{" "}
                                  {formatVersionTime(e.createdAt)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  {isQueueing && (
                    <div className="flex min-w-[220px] max-w-md flex-1 items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {queueLabel}
                          {statusDegraded && (
                            /* Nói thật khi realtime hỏng: người dùng thấy số
                               liệu chậm hơn thì biết là do đâu, thay vì tưởng
                               hệ thống treo. */
                            <span className="ml-1 font-normal text-sky-700/70">
                              · cập nhật chậm
                            </span>
                          )}
                        </p>
                        <Progress
                          value={liveStatus?.status === "processing" ? 70 : 35}
                          className="mt-1 h-1.5"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-2 flex-1 min-h-0 overflow-hidden">
                  <div
                    ref={splitRef}
                    className="flex flex-col xl:flex-row gap-3 xl:gap-0 h-full min-h-0"
                  >
                    <Card
                      style={{ ["--chat-w" as string]: `${chatPct}%` }}
                      className="flex flex-col flex-1 xl:flex-none xl:w-[var(--chat-w)] h-full min-h-0 overflow-hidden rounded-xl"
                    >
                      <CardHeader className="py-3 border-b shrink-0">
                        <CardTitle className="text-sm">Chat với AI</CardTitle>
                        {isQueueing && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Chat mở khi AI xử lý xong — đang xem trước file bên phải.
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                        <ChatPanel
                          messages={review.messages}
                          disabled={!canEdit}
                          onSend={async (content) => {
                            setReview(await sendChat(review.id, content));
                          }}
                        />
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
                      {viewingVersionEntry && (
                        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <span>
                            Đang xem lại{" "}
                            <strong>v{viewingVersionEntry.version}</strong> —{" "}
                            {viewingVersionEntry.label} ·{" "}
                            {viewingVersionEntry.actorName} ·{" "}
                            {formatVersionTime(viewingVersionEntry.createdAt)}{" "}
                            (chỉ đọc)
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setViewVersion(null)}
                          >
                            Về bản hiện tại
                          </Button>
                        </div>
                      )}
                      {viewingVersionEntry ? (
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                          <ReviewedWordView
                            fileName={viewingVersionEntry.fileName}
                            title={`${review.title} — v${viewingVersionEntry.version}`}
                            originalText={review.originalText}
                            reviewedText={viewingVersionEntry.reviewedText}
                            proposals={[]}
                            canEdit={false}
                            docxUrl={viewingVersionEntry.reviewedDocxUrl}
                            onAccept={() => {}}
                            onUndo={() => {}}
                            onAcceptAll={() => {}}
                            onUndoAll={() => {}}
                          />
                        </div>
                      ) : (
                      <ReviewedWordView
                        fileName={review.fileName}
                        title={review.title}
                        originalText={review.originalText}
                        reviewedText={review.reviewedText || review.originalText}
                        proposals={review.proposals}
                        canEdit={canEdit}
                        docxUrl={review.reviewedDocxUrl || review.originalDocxUrl}
                        attachments={review.attachments}
                        contractInsight={review.contractInsight}
                        isInsightRecalculating={insightRecalculating}
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
                            await updateProposalStatus(
                              review.id,
                              proposalId,
                              "undone"
                            )
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
                      )}
                    </Card>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
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
          onJumpToField={() => {
            setHeaderInsightOpen(false);
          }}
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
