"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChatPanel } from "@/components/review/chat-panel";
import { ReviewedWordView } from "@/components/review/reviewed-word-view";
import { useToast } from "@/components/ui/use-toast";
import {
  IntakeFormFields,
  intakeFromReview,
} from "@/components/review/intake-form-fields";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/form-lists-store";
import {
  getSession,
  legalDecide,
  listBusinessEntities,
  listContractBases,
  listContractNames,
  listContractTypes,
  listDiscountOptions,
  listDocumentCategories,
  listReviews,
  managerDecide,
} from "@/lib/review-service";
import { subordinateIds } from "@/lib/user-store";
import type {
  ContractReview,
  ContractTypeConfig,
  DocumentCategory,
  StructuredFeedbackItem,
  UserSession,
} from "@/lib/types";
import {
  ArrowLeft,
  Check,
  FileText,
  FileUp,
  Loader2,
  Paperclip,
  Play,
  Sparkles,
  X,
} from "lucide-react";

export default function TaskInboxPage() {
  const { toast } = useToast();
  const router = useRouter();
  const search = useSearchParams();
  const focusId = search.get("focus");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [session, setSession] = useState<UserSession | null>(null);
  const [reviews, setReviews] = useState<ContractReview[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [types, setTypes] = useState<ContractTypeConfig[]>([]);
  const [discountOptions, setDiscountOptions] = useState<DiscountOption[]>([]);
  const [businessEntities, setBusinessEntities] = useState<CodeLabelOption[]>(
    []
  );
  const [contractBases, setContractBases] = useState<CodeLabelOption[]>([]);
  const [contractNames, setContractNames] = useState<ContractNameOption[]>([]);

  /** Task cá nhân theo role. IT (demo) xem tất cả hàng chờ để giả lập Start. */
  const isIt = session?.role === "it";
  const isLegalApprover =
    session?.role === "legal" || session?.role === "legal_lead" || isIt;
  const isPurchasing = session?.role === "purchasing" || isIt;
  const isManager = session?.role === "purchasing_manager" || isIt;

  /** % chiều rộng cột Chat trong tab AI Workspace (kéo thanh chia để đổi). */
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
    setSession(getSession());
    Promise.all([
      listReviews(),
      listDocumentCategories(),
      listContractTypes(),
      listDiscountOptions(),
      listBusinessEntities(),
      listContractBases(),
      listContractNames(),
    ])
      .then(([all, cats, t, discounts, entities, bases, names]) => {
        setReviews(all);
        setCategories(cats);
        setTypes(t);
        setDiscountOptions(discounts);
        setBusinessEntities(entities);
        setContractBases(bases);
        setContractNames(names);
      })
      .finally(() => setLoading(false));
  }, []);

  // Legal / Manager mở chi tiết duyệt qua ?focus=
  useEffect(() => {
    const role = getSession()?.role;
    if (
      focusId &&
      (role === "legal" ||
        role === "legal_lead" ||
        role === "purchasing_manager")
    ) {
      setActiveId(focusId);
    }
  }, [focusId]);

  /** Task Legal: ticket pending_legal. */
  const legalTasks = useMemo(
    () =>
      isLegalApprover
        ? reviews.filter((r) => r.status === "pending_legal")
        : [],
    [reviews, isLegalApprover]
  );

  /** Task Manager: pending_manager của subordinate (IT demo: mọi pending_manager). */
  const managerTasks = useMemo(() => {
    if (!isManager || !session?.userId) return [];
    if (isIt) {
      return reviews.filter((r) => r.status === "pending_manager");
    }
    const subs = new Set(subordinateIds(session.userId));
    return reviews.filter(
      (r) =>
        r.status === "pending_manager" &&
        r.ownerId &&
        subs.has(r.ownerId)
    );
  }, [reviews, isManager, isIt, session]);

  /** Task Purchasing: rejected của chính user (IT demo: mọi rejected). */
  const purchasingTasks = useMemo(() => {
    if (!isPurchasing || !session?.userId) return [];
    if (isIt) {
      return reviews.filter((r) => r.status === "rejected");
    }
    return reviews.filter(
      (r) =>
        r.status === "rejected" &&
        (r.ownerId === session.userId ||
          (!r.ownerId &&
            (r.ownerName.includes(session.name) ||
              r.ownerName.includes(session.username))))
    );
  }, [reviews, isPurchasing, isIt, session]);

  const active = reviews.find((r) => r.id === activeId) || null;

  const intakeValue = useMemo(
    () =>
      active
        ? intakeFromReview({
            intake: active.intake,
            contractTypeId: active.contractTypeId,
            prompt: active.prompt || "",
          })
        : null,
    [active]
  );

  useEffect(() => {
    setComment("");
    setUploadFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [activeId]);

  const backToList = () => setActiveId(null);

  const decide = async (decision: "approve" | "reject") => {
    if (!active) return;
    if (decision === "reject" && !comment.trim()) {
      toast({
        title: "Cần Comment",
        description: "Khi từ chối phải nhập Comment.",
        variant: "destructive",
      });
      return;
    }
    setActing(true);
    try {
      let updated: ContractReview;
      if (active.status === "pending_manager") {
        updated = await managerDecide(active.id, decision, comment.trim());
        toast({
          title: decision === "approve" ? "Manager đã duyệt" : "Manager đã từ chối",
          description:
            decision === "approve"
              ? "Ticket chuyển sang hàng chờ Legal."
              : "Ticket trả về Task của Purchasing.",
        });
      } else {
        const feedback: StructuredFeedbackItem[] =
          decision === "reject"
            ? [
                {
                  id: `fb_${Date.now()}`,
                  clauseLabel: "Legal feedback",
                  comment: comment.trim(),
                  done: false,
                  attachments: uploadFiles.map((f) => ({
                    name: f.name,
                    size: f.size,
                  })),
                },
              ]
            : [];
        updated = await legalDecide(active.id, decision, feedback);
        toast({
          title: decision === "approve" ? "Đã phê duyệt" : "Đã từ chối",
          description:
            decision === "approve"
              ? "Hệ thống đang đồng bộ sang Econtract (mock)."
              : "Ticket sẽ xuất hiện trong màn Task của Purchasing.",
        });
      }
      setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      backToList();
    } catch (e) {
      toast({
        title: "Lỗi",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
        </div>
      </AppLayout>
    );
  }

  /* ------- Bước 1: danh sách task của chính user (task cá nhân) ------- */
  if (!active) {
    const totalTasks =
      legalTasks.length + managerTasks.length + purchasingTasks.length;
    return (
      <AppLayout>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">Task</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Danh sách ticket cần bạn xử lý — bấm <strong>Start</strong> để mở
              chi tiết và duyệt / xử lý.
              {isIt && (
                <span className="block mt-1 text-amber-700">
                  Demo IT: đang hiển thị mọi hàng chờ (Legal / Manager /
                  Purchasing). Tài khoản thật:{" "}
                  <code className="text-xs">legal</code>,{" "}
                  <code className="text-xs">manager.pur</code>,{" "}
                  <code className="text-xs">van.a</code> / demo123.
                </span>
              )}
            </p>
          </div>

          {totalTasks === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground space-y-2">
                <p>Bạn không có task nào cần xử lý.</p>
                <p className="text-xs">
                  Thử đăng nhập <code>legal</code> / <code>manager.pur</code> /{" "}
                  <code>van.a</code> (mk: demo123) để thấy task giả lập.
                </p>
              </CardContent>
            </Card>
          )}

          {managerTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Chờ Manager duyệt ({managerTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2.5 pr-4 font-medium">Name</th>
                        <th className="py-2.5 w-32 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerTasks.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">
                              {r.intake?.documentName || r.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.code} · {r.contractTypeLabel} · Owner:{" "}
                              {r.ownerName}
                            </div>
                          </td>
                          <td className="py-3">
                            <Button size="sm" onClick={() => setActiveId(r.id)}>
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              Start
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {legalTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Chờ Legal duyệt ({legalTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2.5 pr-4 font-medium">Name</th>
                        <th className="py-2.5 w-32 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legalTasks.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">
                              {r.intake?.documentName || r.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.code} · {r.contractTypeLabel}
                            </div>
                          </td>
                          <td className="py-3">
                            <Button size="sm" onClick={() => setActiveId(r.id)}>
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              Start
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {purchasingTasks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Bị từ chối — cần xử lý ({purchasingTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2.5 pr-4 font-medium">Name</th>
                        <th className="py-2.5 w-32 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasingTasks.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">
                              {r.intake?.documentName || r.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.code} · {r.contractTypeLabel}
                              {r.feedback?.[0]?.comment && (
                                <span className="block mt-0.5 text-destructive/80 truncate max-w-md">
                                  Feedback: {r.feedback[0].comment}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              onClick={() =>
                                router.push(`/dashboard/contracts/${r.id}`)
                              }
                            >
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              Start
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </AppLayout>
    );
  }

  /* ------- Bước 2 (Legal): chi tiết ticket review (tab Thông tin chung / AI Workspace) ------- */
  const attachments = active.attachments?.length
    ? active.attachments
    : [
        {
          id: "primary",
          fileName: active.fileName,
          reviewedDocxUrl: active.reviewedDocxUrl || active.originalDocxUrl,
          originalDocxUrl: active.originalDocxUrl,
        },
      ];

  return (
    <AppLayout lockViewport mainClassName="p-3 pt-14 lg:p-4 lg:pt-4">
      <div className="flex flex-col flex-1 min-h-0 gap-2 overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              Review: {active.intake?.documentName || active.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {active.code} · {active.contractTypeLabel} · Owner:{" "}
              {active.ownerName} · % tin cậy: {active.confidence}%
            </p>
          </div>
          <Button variant="outline" onClick={backToList}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Quay lại danh sách
          </Button>
        </div>

        <Tabs
          defaultValue="info"
          className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden"
        >
          <TabsList className="h-10 shrink-0 self-start">
            <TabsTrigger value="info" className="gap-1.5 px-4">
              <FileText className="h-3.5 w-3.5" />
              Thông tin chung
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
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Thông tin tài liệu</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Thông tin do Purchasing khai báo khi tạo tài liệu (chỉ xem).
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                {intakeValue && (
                  <IntakeFormFields
                    value={intakeValue}
                    onChange={() => {}}
                    categories={categories}
                    types={types}
                    discountOptions={discountOptions}
                    businessEntities={businessEntities}
                    contractBases={contractBases}
                    contractNames={contractNames}
                    disabled
                  />
                )}

                <div className="space-y-2">
                  <Label className="text-sky-800">Hợp đồng review</Label>
                  <p className="text-xs text-sky-700/70">
                    File Word đính kèm — bấm để tải về máy.
                  </p>
                  <ul className="space-y-2">
                    {attachments.map((att) => {
                      const href =
                        att.reviewedDocxUrl ||
                        att.originalDocxUrl ||
                        active.reviewedDocxUrl ||
                        active.originalDocxUrl;
                      if (!href) return null;
                      return (
                        <li key={att.id}>
                          <a
                            href={href}
                            download={att.fileName}
                            className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm hover:bg-muted/60"
                          >
                            <FileText className="h-4 w-4 text-sky-600 shrink-0" />
                            <span className="font-medium text-primary hover:underline truncate">
                              {att.fileName}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    href={`/dashboard/contracts/${active.id}`}
                    className="inline-block text-primary text-sm hover:underline"
                  >
                    Mở workspace chi tiết →
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {active.status === "pending_manager"
                    ? "Quyết định của Purchasing Manager"
                    : "Quyết định của Legal"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Comment</Label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Việc Purchasing cần sửa..."
                    rows={8}
                    className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Upload file</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        setUploadFiles((prev) => [...prev, ...files]);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp className="h-3.5 w-3.5 mr-1.5" />
                      Chọn file
                    </Button>
                    {uploadFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {uploadFiles.map((f, i) => (
                          <Badge
                            key={`${f.name}-${i}`}
                            variant="secondary"
                            className="gap-1 font-normal"
                          >
                            <Paperclip className="h-3 w-3" />
                            {f.name}
                            <button
                              type="button"
                              className="ml-0.5 hover:text-destructive"
                              aria-label={`Xóa ${f.name}`}
                              onClick={() =>
                                setUploadFiles((prev) =>
                                  prev.filter((_, idx) => idx !== i)
                                )
                              }
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    variant="destructive"
                    disabled={acting}
                    onClick={() => decide("reject")}
                  >
                    {acting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <X className="h-4 w-4 mr-2" />
                    )}
                    Từ chối
                  </Button>
                  <Button disabled={acting} onClick={() => decide("approve")}>
                    {acting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    {active.status === "pending_manager"
                      ? "Phê duyệt → Legal"
                      : "Phê duyệt → Econtract"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="ai-review"
            className="mt-0 flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden"
          >
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
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Chỉ xem — lịch sử trao đổi giữa Purchasing và AI.
                  </p>
                </CardHeader>
                <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                  <ChatPanel
                    messages={active.messages}
                    disabled
                    onSend={async () => {}}
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
                <ReviewedWordView
                  fileName={active.fileName}
                  title={active.title}
                  originalText={active.originalText}
                  reviewedText={active.reviewedText || active.originalText}
                  proposals={active.proposals}
                  canEdit={false}
                  docxUrl={active.reviewedDocxUrl || active.originalDocxUrl}
                  attachments={active.attachments}
                  contractInsight={active.contractInsight}
                  onAccept={() => {}}
                  onUndo={() => {}}
                  onAcceptAll={() => {}}
                  onUndoAll={() => {}}
                />
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
