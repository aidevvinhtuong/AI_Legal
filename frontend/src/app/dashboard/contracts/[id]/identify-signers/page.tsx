"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { IdentifySignersPanel } from "@/components/signing/identify-signers-panel";
import { StatusBadge } from "@/components/review/status-badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  applySigningMatrix,
  getReviewById,
  getSession,
  saveSigningRecipients,
} from "@/lib/review-service";
import { validateIdentifySigners } from "@/lib/econtract-flow";
import type { ContractReview, SignRecipient } from "@/lib/types";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Save } from "lucide-react";

type StepItem =
  | { id: "detail"; label: string; kind: "link" }
  | { id: "identify" | "design" | "confirm"; label: string; kind: "step" };

const STEPS: StepItem[] = [
  { id: "detail", label: "Xem chi tiết tài liệu", kind: "link" },
  { id: "identify", label: "Xác định người ký", kind: "step" },
  { id: "design", label: "Thiết kế tài liệu", kind: "step" },
  { id: "confirm", label: "Xác nhận và hoàn tất", kind: "step" },
];

function snapshotRecipients(list: SignRecipient[]): string {
  return JSON.stringify(
    list.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      partyId: r.partyId,
      orgName: r.orgName,
      isMyOrg: r.isMyOrg,
      partyKind: r.partyKind,
      ecRole: r.ecRole,
      signType: r.signType,
      notifyTypes: r.notifyTypes,
      order: r.order,
    }))
  );
}

export default function IdentifySignersPage() {
  const params = useParams();
  const id = String(params.id || "");
  const router = useRouter();
  const { toast } = useToast();

  const [review, setReview] = useState<ContractReview | null>(null);
  const [recipients, setRecipients] = useState<SignRecipient[]>([]);
  const [savedSnap, setSavedSnap] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () => !!savedSnap && snapshotRecipients(recipients) !== savedSnap,
    [recipients, savedSnap]
  );

  const reload = useCallback(async () => {
    let r = await getReviewById(id);
    if (r.status === "pending_markers") {
      try {
        const { review: updated } = await applySigningMatrix(r.id);
        r = updated;
      } catch {
        /* đã có recipients hoặc ma trận lỗi — vẫn cho sửa tay */
      }
    }
    const list = r.recipients.filter((x) => x.markerType !== "st");
    setReview(r);
    setRecipients(list);
    setSavedSnap(snapshotRecipients(list));
    return r;
  }, [id]);

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.push("/login");
      return;
    }
    reload()
      .catch(() =>
        toast({ title: "Không tải được ticket", variant: "destructive" })
      )
      .finally(() => setLoading(false));
  }, [reload, router, toast]);

  const guardUnsaved = (href: string) => {
    if (dirty) {
      toast({
        title: "Chưa lưu thay đổi",
        description: "Bấm «Lưu thao tác» trước khi chuyển trang.",
        variant: "destructive",
      });
      return;
    }
    router.push(href);
  };

  const persist = async (goNext: boolean) => {
    if (!review) return;
    const errors = validateIdentifySigners(recipients);
    if (errors.length) {
      toast({
        title: "Chưa đủ thông tin người ký",
        description: errors[0],
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const updated = await saveSigningRecipients(review.id, recipients);
      const list = updated.recipients.filter((x) => x.markerType !== "st");
      setReview(updated);
      setRecipients(list);
      setSavedSnap(snapshotRecipients(list));
      toast({ title: goNext ? "Đã lưu — sang thiết kế" : "Đã lưu thao tác" });
      if (goNext) {
        router.push(`/dashboard/contracts/${review.id}/design-markers`);
      }
    } catch (e) {
      toast({
        title: "Không lưu được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !review) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
        </div>
      </AppLayout>
    );
  }

  const canEdit = review.status === "pending_markers";
  const buyerOrg =
    review.intake?.businessEntityLabel ||
    "CÔNG TY TNHH SAINT-GOBAIN VIỆT NAM";
  const detailHref = `/dashboard/contracts/${review.id}`;

  return (
    <AppLayout lockViewport mainClassName="p-0 lg:p-0">
      <div className="flex h-[calc(100dvh-4rem)] flex-col bg-slate-100">
        <div className="shrink-0 border-b bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h1 className="text-base font-semibold">
                Xác định người ký · {review.code}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={review.status} />
                <span>{review.title}</span>
                {dirty && (
                  <span className="text-amber-700">· Chưa lưu</span>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => guardUnsaved(detailHref)}
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Quay lại
            </Button>
          </div>
          <ol className="flex flex-wrap gap-6 text-sm">
            {STEPS.map((item, index) => {
              const num = index + 1;
              const active = item.id === "identify";
              if (item.kind === "link") {
                return (
                  <li key={item.id} className="relative pb-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-sky-700 font-medium hover:underline"
                      onClick={() => guardUnsaved(detailHref)}
                    >
                      <span>{num}. {item.label}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              }
              return (
                <li key={item.id} className="relative pb-2">
                  <span
                    className={
                      active
                        ? "font-medium text-sky-700"
                        : "text-muted-foreground/70"
                    }
                  >
                    {num}. {item.label}
                  </span>
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-600" />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden p-3 md:p-4 flex flex-col">
          <div className="min-h-0 flex-1">
            <IdentifySignersPanel
              recipients={recipients}
              defaultBuyerOrgName={buyerOrg}
              onChange={setRecipients}
              readOnly={!canEdit}
            />
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => guardUnsaved("/dashboard/tasks")}
          >
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Quay lại
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit || saving || !dirty}
              onClick={() => persist(false)}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              Lưu thao tác
            </Button>
            <Button
              size="sm"
              disabled={!canEdit || saving}
              onClick={() => persist(true)}
            >
              Tiếp theo
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
