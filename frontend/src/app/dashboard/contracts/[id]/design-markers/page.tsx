"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppLayout from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/review/status-badge";
import { useToast } from "@/components/ui/use-toast";
import { UI_ROLE_LABEL, normalizeUiRole } from "@/lib/econtract-flow";
import {
  completeMarkersAndPushEcontract,
  getReviewById,
  getSession,
  placeMarkerOnDocument,
  recipientNeedsMarker,
  updateRecipient,
  validateMarkers,
} from "@/lib/review-service";
import type { ContractReview, EcontractSignType, SignRecipient } from "@/lib/types";
import {
  ArrowLeft,
  ExternalLink,
  FileImage,
  Loader2,
  PenLine,
  Save,
  Send,
  Stamp,
} from "lucide-react";

type PaletteItem = {
  id: string;
  label: string;
  signType: EcontractSignType;
  markerType: "is" | "ds";
  color: string;
  icon: React.ReactNode;
};

const PALETTE: PaletteItem[] = [
  {
    id: "sign_img",
    label: "Chữ ký ảnh",
    signType: "sign_img",
    markerType: "is",
    color: "bg-sky-500",
    icon: <FileImage className="h-5 w-5" />,
  },
  {
    id: "sign_fca",
    label: "Chữ ký số",
    signType: "sign_fca.passcode",
    markerType: "ds",
    color: "bg-amber-400",
    icon: <PenLine className="h-5 w-5" />,
  },
  {
    id: "sign_ekyc",
    label: "Ký ảnh số",
    signType: "sign_ekyc",
    markerType: "ds",
    color: "bg-emerald-500",
    icon: <Stamp className="h-5 w-5" />,
  },
];

const PAGE_COUNT = 4;

const STEPS: { id: string; label: string; kind: "link" | "step" }[] = [
  { id: "detail", label: "Xem chi tiết tài liệu", kind: "link" },
  { id: "identify", label: "Xác định người ký", kind: "step" },
  { id: "design", label: "Thiết kế tài liệu", kind: "step" },
  { id: "confirm", label: "Xác nhận và hoàn tất", kind: "step" },
];

export default function DesignMarkersPage() {
  const params = useParams();
  const id = String(params.id || "");
  const router = useRouter();
  const { toast } = useToast();

  const [review, setReview] = useState<ContractReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [dragSignType, setDragSignType] = useState<EcontractSignType | null>(
    null
  );
  const [sizePreset, setSizePreset] = useState<"default" | "large">("default");

  const reload = useCallback(async () => {
    const r = await getReviewById(id);
    setReview(r);
    const firstSigner = r.recipients.find(recipientNeedsMarker);
    setSelectedRecipientId((prev) => prev || firstSigner?.id || "");
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

  const signers = useMemo(
    () => (review ? review.recipients.filter(recipientNeedsMarker) : []),
    [review]
  );
  const errors = useMemo(
    () => (review ? validateMarkers(review.recipients) : []),
    [review]
  );
  const placementsOnPage = useMemo(() => {
    if (!review) return [] as SignRecipient[];
    return review.recipients.filter(
      (r) => r.marker && (r.marker.page ?? 1) === page
    );
  }, [review, page]);

  const selectedMarkerRecipient = useMemo(() => {
    if (!review) return null;
    if (selectedMarkerId) {
      return (
        review.recipients.find((r) => r.id === selectedMarkerId) || null
      );
    }
    return review.recipients.find((r) => r.id === selectedRecipientId) || null;
  }, [review, selectedMarkerId, selectedRecipientId]);

  const dims = sizePreset === "large"
    ? { width: 220, height: 140 }
    : { width: 164, height: 98 };

  const placeAt = async (
    signType: EcontractSignType,
    xPct: number,
    yPct: number
  ) => {
    if (!review || !selectedRecipientId) {
      toast({
        title: "Chọn người ký trước",
        description:
          "Chọn Người ký / Văn thư ở panel phải hoặc danh sách trái, rồi kéo loại ký vào trang.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const updated = await placeMarkerOnDocument(
        review.id,
        selectedRecipientId,
        {
          page,
          xPct,
          yPct,
          signType,
          height: dims.height,
          width: dims.width,
          sizePreset,
        }
      );
      setReview(updated);
      setSelectedMarkerId(selectedRecipientId);
      toast({ title: "Đã đặt vị trí chữ ký" });
    } catch (e) {
      toast({
        title: "Không đặt được marker",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const signType = (e.dataTransfer.getData("signType") ||
      dragSignType) as EcontractSignType | null;
    if (!signType) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = Math.min(
      100,
      Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)
    );
    const yPct = Math.min(
      100,
      Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)
    );
    setDragSignType(null);
    await placeAt(signType, xPct, yPct);
  };

  const updateSelectedMarkerMeta = async (patch: {
    sizePreset?: "default" | "large";
    xPct?: number;
    yPct?: number;
    width?: number;
    height?: number;
    recipientId?: string;
  }) => {
    if (!review || !selectedMarkerRecipient?.marker) return;
    const fromId = selectedMarkerRecipient.id;
    const toId = patch.recipientId || fromId;
    const preset = patch.sizePreset || selectedMarkerRecipient.marker.sizePreset || sizePreset;
    const w =
      patch.width ??
      (preset === "large" ? 220 : 164);
    const h =
      patch.height ??
      (preset === "large" ? 140 : 98);

    setSaving(true);
    try {
      if (toId !== fromId) {
        await updateRecipient(review.id, fromId, { marker: undefined });
      }
      const updated = await placeMarkerOnDocument(review.id, toId, {
        page: selectedMarkerRecipient.marker.page || page,
        xPct: patch.xPct ?? selectedMarkerRecipient.marker.xPct ?? 50,
        yPct: patch.yPct ?? selectedMarkerRecipient.marker.yPct ?? 50,
        width: w,
        height: h,
        sizePreset: preset,
        signType: selectedMarkerRecipient.signType,
      });
      setReview(updated);
      setSelectedRecipientId(toId);
      setSelectedMarkerId(toId);
      if (patch.sizePreset) setSizePreset(patch.sizePreset);
    } catch (e) {
      toast({
        title: "Không cập nhật được marker",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePush = async () => {
    if (!review) return;
    if (errors.length) {
      toast({
        title: "Chưa đủ marker",
        description: errors[0],
        variant: "destructive",
      });
      return;
    }
    setPushing(true);
    try {
      const updated = await completeMarkersAndPushEcontract(review.id);
      setReview(updated);
      toast({
        title: "Đã Submit sang eContract",
        description: updated.econtract?.envelopeId
          ? `envelopeId: ${updated.econtract.envelopeId}`
          : updated.econtract?.message || "Đang đồng bộ",
      });
      router.push(`/dashboard/contracts/${review.id}`);
    } catch (e) {
      toast({
        title: "Không đẩy eContract được",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
      await reload().catch(() => undefined);
    } finally {
      setPushing(false);
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

  const canDesign = review.status === "pending_markers";

  return (
    <AppLayout lockViewport mainClassName="p-0 lg:p-0">
      <div className="flex h-[calc(100dvh-4rem)] flex-col bg-slate-100">
        <div className="shrink-0 border-b bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h1 className="text-base font-semibold">
                Thiết kế tài liệu · {review.code}
              </h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={review.status} />
                <span>{review.title}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/contracts/${review.id}/identify-signers`}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Quay lại người ký
              </Link>
            </Button>
          </div>
          <ol className="flex flex-wrap gap-6 text-sm">
            {STEPS.map((item, index) => {
              const num = index + 1;
              const active = item.id === "design";
              if (item.kind === "link") {
                return (
                  <li key={item.id} className="relative pb-2">
                    <Link
                      href={`/dashboard/contracts/${review.id}`}
                      className="inline-flex items-center gap-1 text-sky-700 font-medium hover:underline"
                    >
                      <span>
                        {num}. {item.label}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                );
              }
              if (item.id === "identify") {
                return (
                  <li key={item.id} className="relative pb-2">
                    <Link
                      href={`/dashboard/contracts/${review.id}/identify-signers`}
                      className="text-muted-foreground hover:underline"
                    >
                      {num}. {item.label}
                    </Link>
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

        <div className="flex min-h-0 flex-1">
          <aside className="w-56 shrink-0 border-r bg-white p-3 space-y-3 overflow-y-auto">
            <div className="text-sm font-semibold">Cấu hình mẫu chữ ký</div>
            <div className="space-y-2">
              {PALETTE.map((p) => (
                <div
                  key={p.id}
                  draggable={canDesign}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("signType", p.signType);
                    setDragSignType(p.signType);
                  }}
                  onDragEnd={() => setDragSignType(null)}
                  className={`${p.color} cursor-grab active:cursor-grabbing rounded-md px-3 py-3 text-white shadow-sm select-none`}
                >
                  <div className="flex items-center gap-2">
                    {p.icon}
                    <span className="text-sm font-medium">{p.label}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Cần gán marker ({signers.length})
              </div>
              {signers.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedRecipientId(r.id);
                    if (r.marker) setSelectedMarkerId(r.id);
                  }}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                    selectedRecipientId === r.id
                      ? "border-sky-500 bg-sky-50"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-muted-foreground truncate">
                    {UI_ROLE_LABEL[normalizeUiRole(r.ecRole)]} · {r.orgName}
                  </div>
                  {r.marker ? (
                    <Badge className="mt-1 text-[10px]" variant="secondary">
                      Đã đặt
                    </Badge>
                  ) : (
                    <Badge className="mt-1 text-[10px]" variant="outline">
                      Chưa đặt
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-center gap-3 border-b bg-white px-3 py-2 text-xs">
              <button
                type="button"
                className="rounded border px-2 py-0.5 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span>
                {page} / {PAGE_COUNT}
              </span>
              <button
                type="button"
                className="rounded border px-2 py-0.5 disabled:opacity-40"
                disabled={page >= PAGE_COUNT}
                onClick={() => setPage((p) => Math.min(PAGE_COUNT, p + 1))}
              >
                ›
              </button>
              <select
                className="rounded border px-2 py-0.5"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {[75, 100, 125, 150].map((z) => (
                  <option key={z} value={z}>
                    {z}%
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div
                className="mx-auto bg-white shadow-md relative"
                style={{
                  width: `${(210 * zoom) / 100}mm`,
                  minHeight: `${(297 * zoom) / 100}mm`,
                  maxWidth: "100%",
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={canDesign ? onDrop : undefined}
              >
                <div className="pointer-events-none absolute inset-0 p-8 text-[11px] leading-relaxed text-slate-700">
                  <div className="text-center font-semibold text-sm mb-4">
                    {review.title || "AI Legal — Hợp đồng"}
                  </div>
                  <p className="mb-2">
                    Trang {page} — kéo loại ký vào vị trí cần đặt. Chỉ Người ký
                    chính và Văn thư cần marker.
                  </p>
                  <p className="text-muted-foreground">File: {review.fileName}</p>
                </div>

                {placementsOnPage.map((r) => {
                  const m = r.marker!;
                  const palette = PALETTE.find((p) => p.signType === r.signType);
                  const w = m.width ?? 164;
                  const h = m.height ?? 98;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedMarkerId(r.id);
                        setSelectedRecipientId(r.id);
                        setSizePreset(m.sizePreset || "default");
                      }}
                      className={`absolute z-10 rounded border-2 px-1 text-[10px] font-medium text-white shadow ${
                        palette?.color || "bg-sky-600"
                      } ${
                        selectedMarkerId === r.id
                          ? "border-yellow-300 ring-2 ring-yellow-300"
                          : "border-white"
                      }`}
                      style={{
                        left: `${m.xPct ?? 50}%`,
                        top: `${m.yPct ?? 50}%`,
                        width: w,
                        height: h,
                        transform: "translate(-50%, -50%)",
                      }}
                      title={m.positionLabel}
                    >
                      {r.name}
                    </button>
                  );
                })}

                {!canDesign && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 text-sm text-muted-foreground">
                    Ticket không ở trạng thái chờ gán chữ ký
                    {review.econtract?.envelopeId
                      ? ` — envelope ${review.econtract.envelopeId}`
                      : "."}
                  </div>
                )}
              </div>
            </div>
          </main>

          <aside className="w-72 shrink-0 border-l bg-white p-3 overflow-y-auto space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Thông tin chung
              </div>
              <div className="space-y-2">
                <div>
                  <Label className="text-[11px]">Người nhận (Người ký / Văn thư)</Label>
                  <select
                    className="mt-1 h-9 w-full rounded-md border px-2 text-sm"
                    disabled={!canDesign}
                    value={
                      selectedMarkerRecipient?.id || selectedRecipientId || ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedRecipientId(v);
                      if (selectedMarkerRecipient?.marker) {
                        void updateSelectedMarkerMeta({ recipientId: v });
                      }
                    }}
                  >
                    <option value="">— Chọn —</option>
                    {signers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({UI_ROLE_LABEL[normalizeUiRole(r.ecRole)]})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Vị trí — Kích thước
              </div>
              <div className="flex gap-3 mb-2 text-sm">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={sizePreset === "default"}
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    onChange={() =>
                      void updateSelectedMarkerMeta({ sizePreset: "default" })
                    }
                  />
                  Mặc định
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={sizePreset === "large"}
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    onChange={() =>
                      void updateSelectedMarkerMeta({ sizePreset: "large" })
                    }
                  />
                  Lớn
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">X (%)</Label>
                  <Input
                    type="number"
                    className="h-8"
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    value={selectedMarkerRecipient?.marker?.xPct ?? ""}
                    onChange={(e) =>
                      void updateSelectedMarkerMeta({
                        xPct: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Y (%)</Label>
                  <Input
                    type="number"
                    className="h-8"
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    value={selectedMarkerRecipient?.marker?.yPct ?? ""}
                    onChange={(e) =>
                      void updateSelectedMarkerMeta({
                        yPct: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Chiều rộng</Label>
                  <Input
                    type="number"
                    className="h-8"
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    value={selectedMarkerRecipient?.marker?.width ?? dims.width}
                    onChange={(e) =>
                      void updateSelectedMarkerMeta({
                        width: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Chiều cao</Label>
                  <Input
                    type="number"
                    className="h-8"
                    disabled={!canDesign || !selectedMarkerRecipient?.marker}
                    value={
                      selectedMarkerRecipient?.marker?.height ?? dims.height
                    }
                    onChange={(e) =>
                      void updateSelectedMarkerMeta({
                        height: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {review.econtract && (
              <div className="rounded-md border bg-slate-50 p-2 text-xs space-y-1">
                <div className="font-semibold">Trạng thái eContract</div>
                <div>envelopeId: {review.econtract.envelopeId || "—"}</div>
                <div>status: {review.econtract.envStatus || "—"}</div>
                <div className="text-muted-foreground">
                  {review.econtract.message || review.econtract.error}
                </div>
              </div>
            )}
          </aside>
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-3">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/contracts/${review.id}/identify-signers`}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Quay lại
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={saving || !canDesign}
              onClick={() =>
                toast({
                  title: "Đã lưu thao tác",
                  description: "Vị trí chữ ký lưu trên ticket.",
                })
              }
            >
              <Save className="h-3.5 w-3.5 mr-1" />
              Lưu thao tác
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {errors.length > 0 && (
              <span className="text-xs text-destructive max-w-md truncate">
                {errors[0]}
              </span>
            )}
            <Button
              size="sm"
              disabled={!canDesign || pushing || errors.length > 0}
              onClick={handlePush}
            >
              {pushing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1" />
              )}
              Submit
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
