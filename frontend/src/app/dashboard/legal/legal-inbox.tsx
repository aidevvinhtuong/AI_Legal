"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/review/status-badge";
import { useToast } from "@/components/ui/use-toast";
import { getSession, legalDecide, listReviews } from "@/lib/review-service";
import { canAccessLegalInbox } from "@/lib/roles";
import type { ContractReview, StructuredFeedbackItem } from "@/lib/types";
import { Check, FileUp, Loader2, Paperclip, X } from "lucide-react";

function FieldRow({ label, value }: { label: string; value?: string | number | null }) {
  const display =
    value === undefined || value === null || value === ""
      ? "—"
      : String(value);
  return (
    <div className="min-w-0 space-y-0.5 text-sm py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words leading-snug">{display}</dd>
    </div>
  );
}

export default function LegalInboxPage() {
  const { toast } = useToast();
  const search = useSearchParams();
  const focusId = search.get("focus");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reviews, setReviews] = useState<ContractReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  useEffect(() => {
    const session = getSession();
    if (session && !canAccessLegalInbox(session.role)) {
      toast({
        title: "Chỉ Legal / IT mới vào hộp duyệt",
        variant: "destructive",
      });
    }
    listReviews()
      .then((all) => {
        setReviews(all);
        setSelectedId((prev) => {
          if (prev) return prev;
          const pending = all.find((r) => r.status === "pending_legal");
          return pending?.id ?? null;
        });
      })
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const pending = useMemo(
    () => reviews.filter((r) => r.status === "pending_legal"),
    [reviews]
  );
  const selected = reviews.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    setComment("");
    setUploadFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [selectedId]);

  const decide = async (decision: "approve" | "reject") => {
    if (!selected) return;
    if (decision === "reject" && !comment.trim()) {
      toast({
        title: "Cần Comment",
        description: "Khi từ chối phải nhập Comment.",
        variant: "destructive",
      });
      return;
    }
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
    setActing(true);
    try {
      const updated = await legalDecide(selected.id, decision, feedback);
      setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast({
        title: decision === "approve" ? "Đã phê duyệt" : "Đã từ chối",
        description:
          decision === "approve"
            ? "Hệ thống đang đồng bộ sang Econtract (mock callback)."
            : "Purchasing sẽ thấy checklist việc cần sửa.",
      });
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

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Hộp duyệt Legal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Xem toàn bộ hợp đồng · phê duyệt / từ chối kèm Structured Feedback (single-step)
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Chờ duyệt ({pending.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có HĐ đang chờ.</p>
              ) : (
                pending.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left rounded-lg border p-3 hover:bg-muted/50 ${
                      selectedId === r.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="font-medium text-sm">{r.code}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.title}</div>
                    <div className="mt-1">
                      <StatusBadge status={r.status} />
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                {selected ? selected.code : "Chọn một hợp đồng"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">Chưa chọn HĐ.</p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border p-3">
                    <h4 className="text-sm font-semibold mb-2">Thông tin hợp đồng</h4>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                      <FieldRow label="Mã HĐ" value={selected.code} />
                      <FieldRow label="Tiêu đề" value={selected.title} />
                      <FieldRow
                        label="Giá trị hợp đồng (VND)"
                        value={
                          selected.intake?.contractValue ||
                          selected.fields.find((f) => f.id === "contract_value")
                            ?.value
                        }
                      />
                      <FieldRow label="Loại HĐ" value={selected.contractTypeLabel} />
                      <FieldRow label="Owner" value={selected.ownerName} />
                      <FieldRow label="% tin cậy" value={`${selected.confidence}%`} />
                      <FieldRow
                        label="Fairness"
                        value={
                          selected.contractInsight
                            ? `${selected.contractInsight.fairnessScore}/100`
                            : undefined
                        }
                      />
                      <FieldRow
                        label="Loại tài liệu"
                        value={selected.intake?.documentCategoryLabel}
                      />
                      <FieldRow
                        label="Tên tài liệu"
                        value={selected.intake?.documentName}
                      />
                      <FieldRow
                        label="Số tài liệu"
                        value={selected.intake?.documentNumber}
                      />
                      <FieldRow
                        label="Có chiết khấu"
                        value={
                          selected.intake?.hasDiscount === "yes"
                            ? "Có"
                            : selected.intake?.hasDiscount === "no"
                              ? "Không"
                              : selected.intake?.hasDiscount
                        }
                      />
                      <FieldRow
                        label="Chi tiết CK"
                        value={selected.intake?.discountDetails}
                      />
                    </dl>

                    <div className="mt-3 space-y-1.5 sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Tài liệu ký</p>
                      <div className="flex flex-wrap gap-2">
                        {(selected.attachments?.length
                          ? selected.attachments
                          : [
                              {
                                id: "primary",
                                fileName: selected.fileName,
                                reviewedDocxUrl:
                                  selected.reviewedDocxUrl ||
                                  selected.originalDocxUrl,
                                originalDocxUrl: selected.originalDocxUrl,
                              },
                            ]
                        ).map((att) => {
                          const href =
                            att.reviewedDocxUrl ||
                            att.originalDocxUrl ||
                            selected.reviewedDocxUrl ||
                            selected.originalDocxUrl;
                          if (!href) return null;
                          return (
                            <a
                              key={att.id}
                              href={href}
                              download={att.fileName}
                              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-muted hover:underline"
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0" />
                              {att.fileName}
                            </a>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Đính kèm file Word — bấm để tải về máy.
                      </p>
                    </div>

                    <Link
                      href={`/dashboard/contracts/${selected.id}`}
                      className="inline-block mt-3 text-primary text-sm hover:underline"
                    >
                      Mở workspace chi tiết →
                    </Link>
                  </div>

                  <div className="space-y-3 rounded-lg border p-3">
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
                      Phê duyệt → Econtract
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}
