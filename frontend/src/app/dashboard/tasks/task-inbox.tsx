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
import { AttachmentsPanel } from "@/components/review/attachments-panel";
import { CommentPanel } from "@/components/review/comment-panel";
import { LegalEditsPanel } from "@/components/review/legal-edits-panel";
import { ReviewedWordView } from "@/components/review/reviewed-word-view";
import type {
  DocSelection,
  SuperDocHandle,
  SuperDocMode,
} from "@/components/review/superdoc-embed";
import { StatusBadge } from "@/components/review/status-badge";
import { useToast } from "@/components/ui/use-toast";
import { downloadFile } from "@/lib/api";
import {
  IntakeFormFields,
  intakeFromReview,
} from "@/components/review/intake-form-fields";
import type {
  CodeLabelOption,
  ContractNameOption,
  DiscountOption,
} from "@/lib/form-lists-store";
import { getSession } from "@/lib/session";
import {
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
import { canSuggestEdits } from "@/lib/roles";
import { displayFullName } from "@/lib/user-store";
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

/** Dòng Name trên bảng Task: Số tài liệu - Tên tài liệu / Họ tên người yêu cầu. */
function taskNameLines(r: ContractReview) {
  const docNo = r.intake?.documentNumber || r.code || "—";
  const docName = r.intake?.documentName || r.title || "—";
  const requester = displayFullName({
    ownerId: r.ownerId,
    ownerName: r.ownerName,
  });
  return {
    primary: `${docNo} - ${docName}`,
    requester,
  };
}

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
    session?.role === "legal" || isIt;
  const isPurchasing = session?.role === "purchasing" || isIt;
  const isManager = session?.role === "purchasing_manager" || isIt;

  /** % chiều rộng cột Chat trong tab AI Workspace (kéo thanh chia để đổi). */
  const [chatPct, setChatPct] = useState(42);
  // TH1 + TH2 phải làm được TỪ ĐÂY. Task inbox mới là nơi Manager/Legal thật sự
  // ngồi duyệt; bắt họ mở sang workspace của Purchasing để bình luận là bắt đi
  // vòng, và workspace đó vốn dựng cho người tạo ticket.
  const [leftTab, setLeftTab] = useState<
    "chat" | "comments" | "edits" | "files"
  >("chat");
  const superDocRef = useRef<SuperDocHandle>(null);
  const [superDocMode, setSuperDocMode] = useState<SuperDocMode>("viewing");
  const [docSelection, setDocSelection] = useState<DocSelection | null>(null);
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
      (role === "legal" || role === "purchasing_manager")
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

  /**
   * Task Manager: các ticket đang chờ mình duyệt.
   *
   * Không lọc theo cấp dưới ở đây nữa: `GET /api/v1/reviews` đã trả đúng phạm
   * vi của người gọi theo Line Manager (quy tắc A5, enforce server-side).
   */
  const managerTasks = useMemo(() => {
    if (!isManager || !session?.userId) return [];
    return reviews.filter((r) => r.status === "pending_manager");
  }, [reviews, isManager, session]);

  /** Task Purchasing: rejected + chờ gán chữ ký sau Legal (IT demo: mọi ticket). */
  const purchasingTasks = useMemo(() => {
    if (!isPurchasing || !session?.userId) return [];
    // Backend luôn trả `ownerId`; so khớp theo tên là di sản thời mock và sẽ
    // gom nhầm những người trùng tên.
    const isOwner = (r: (typeof reviews)[0]) => r.ownerId === session.userId;
    if (isIt) {
      return reviews.filter(
        (r) => r.status === "rejected" || r.status === "pending_markers"
      );
    }
    return reviews.filter(
      (r) =>
        (r.status === "rejected" || r.status === "pending_markers") && isOwner(r)
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
              ? "Ticket gửi người tạo để kéo-thả vị trí chữ ký trước khi đẩy eContract."
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
                  Vai trò IT: đang hiển thị mọi hàng chờ (Legal / Manager /
                  Purchasing).
                </span>
              )}
            </p>
          </div>

          {totalTasks === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                <p>Bạn không có task nào cần xử lý.</p>
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
                      {managerTasks.map((r) => {
                        const name = taskNameLines(r);
                        return (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">{name.primary}</div>
                            <div className="text-xs text-muted-foreground">
                              {name.requester}
                            </div>
                          </td>
                          <td className="py-3">
                            <Button size="sm" onClick={() => setActiveId(r.id)}>
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              Start
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
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
                      {legalTasks.map((r) => {
                        const name = taskNameLines(r);
                        return (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">{name.primary}</div>
                            <div className="text-xs text-muted-foreground">
                              {name.requester}
                            </div>
                          </td>
                          <td className="py-3">
                            <Button size="sm" onClick={() => setActiveId(r.id)}>
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              Start
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
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
                  Task người tạo ({purchasingTasks.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Từ chối cần sửa lại, hoặc Legal đã duyệt — cần gán vị trí chữ
                  ký.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2.5 pr-4 font-medium">Name</th>
                        <th className="py-2.5 pr-4 font-medium">Status</th>
                        <th className="py-2.5 w-40 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasingTasks.map((r) => {
                        const name = taskNameLines(r);
                        const isMarkers = r.status === "pending_markers";
                        return (
                        <tr
                          key={r.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">{name.primary}</div>
                            <div className="text-xs text-muted-foreground">
                              {name.requester}
                              {r.feedback?.[0]?.comment && (
                                <span className="block mt-0.5 text-destructive/80 truncate max-w-md">
                                  Feedback: {r.feedback[0].comment}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="py-3">
                            <Button
                              size="sm"
                              onClick={() =>
                                router.push(
                                  isMarkers
                                    ? `/dashboard/contracts/${r.id}/identify-signers`
                                    : `/dashboard/contracts/${r.id}`
                                )
                              }
                            >
                              <Play className="h-3.5 w-3.5 mr-1.5" />
                              {isMarkers ? "Gán chữ ký" : "Start"}
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
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
              Review: {taskNameLines(active).primary}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {taskNameLines(active).requester} · % tin cậy: {active.confidence}%
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
                      // Endpoint file của backend kiểm quyền bằng Bearer token;
                      // `<a href>` trần không gửi được header nên luôn 401.
                      const needsAuth = href.startsWith("/api/");
                      return (
                        <li key={att.id}>
                          {needsAuth ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                              onClick={() => {
                                void downloadFile(href, att.fileName).catch(
                                  (err) =>
                                    toast({
                                      title: "Không tải được file",
                                      description:
                                        err instanceof Error
                                          ? err.message
                                          : "Lỗi",
                                      variant: "destructive",
                                    })
                                );
                              }}
                            >
                              <FileText className="h-4 w-4 text-sky-600 shrink-0" />
                              <span className="font-medium text-primary hover:underline truncate">
                                {att.fileName}
                              </span>
                            </button>
                          ) : (
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
                          )}
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
                  {leftTab === "chat" && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Chỉ xem — lịch sử trao đổi giữa Purchasing và AI.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {leftTab === "chat" && (
                    <ChatPanel
                      messages={active.messages}
                      disabled
                      onSend={async () => {}}
                    />
                  )}
                  {leftTab === "comments" && (
                    <CommentPanel
                      reviewId={active.id}
                      fields={active.fields}
                      canComment
                      documentSelection={docSelection}
                    />
                  )}
                  {leftTab === "edits" && (
                    <LegalEditsPanel
                      reviewId={active.id}
                      collectSuggestions={
                        superDocMode === "suggesting"
                          ? () => superDocRef.current?.collectSuggestions() ?? []
                          : null
                      }
                      // Người duyệt KHÔNG áp được: áp là ghi tài liệu, và tài
                      // liệu lúc này đang ở hàng chờ duyệt. Họ Từ chối để trả
                      // hồ sơ về Purchasing — quy tắc A4b.
                      canApply={false}
                    />
                  )}
                  {leftTab === "files" && (
                    // TH3: gửi kèm bản đã sửa bằng Word. KHÔNG thay tài liệu —
                    // Purchasing đọc rồi tự quyết sửa gì qua PT1/PT2/PT3.
                    <AttachmentsPanel reviewId={active.id} canAttach />
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
                  superDocRef={superDocRef}
                  superDocMode={superDocMode}
                  onSuperDocModeChange={
                    canSuggestEdits(session)
                      ? (mode) => {
                          // Đổi chế độ là remount tài liệu ⇒ track changes chưa
                          // gửi mất sạch. Hỏi trước.
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
                />
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
