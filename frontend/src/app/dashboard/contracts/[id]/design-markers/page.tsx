"use client";

/**
 * Bước 3 của wizard trình ký — đặt ô ký vào tài liệu.
 *
 * Bản trước vẽ một trang A4 GIẢ rồi cho thả tự do lên đó, và gửi lên backend
 * `{page, xPct, yPct}`. Hai vấn đề: trang đó không phải tài liệu thật, và toạ
 * độ trang không ánh xạ ngược được sang OOXML (FPT nhận `.docx` base64, không
 * có bước render PDF nào để dịch). Kết quả là ô ký rơi vào chỗ ngẫu nhiên.
 *
 * Bản này thả vào **đoạn văn thật** của hợp đồng, lấy từ
 * `GET /api/v1/reviews/{id}/marker-anchors`. Thao tác vẫn là kéo-thả, chỉ khác
 * là có điểm hít nên không bao giờ trượt. Mặc định lọc về khối chữ ký (backend
 * nhận ra bằng dấu hiệu cấu trúc), bỏ lọc thì thấy toàn bộ tài liệu.
 */

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
import { UI_ROLE_LABEL, normalizeUiRole } from "@/lib/domain/econtract-flow";
import { getSession } from "@/lib/auth/session";
import {
  completeMarkersAndPushEcontract,
  getMarkerAnchors,
  getReviewById,
  placeMarkerOnDocument,
  recipientNeedsMarker,
  removeMarker,
  validateMarkers,
} from "@/lib/services/reviews";
import type {
  ContractReview,
  EcontractSignType,
  MarkerAnchor,
  SignRecipient,
} from "@/lib/domain/types";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileImage,
  Loader2,
  PenLine,
  Send,
  Stamp,
  Trash2,
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

const STEPS: { id: string; label: string; kind: "link" | "step" }[] = [
  { id: "detail", label: "Xem chi tiết tài liệu", kind: "link" },
  { id: "identify", label: "Xác định người ký", kind: "step" },
  { id: "design", label: "Thiết kế tài liệu", kind: "step" },
  { id: "confirm", label: "Xác nhận và hoàn tất", kind: "step" },
];

const SIZE = {
  default: { width: 164, height: 98 },
  large: { width: 220, height: 140 },
} as const;

export default function DesignMarkersPage() {
  const params = useParams();
  const id = String(params.id || "");
  const router = useRouter();
  const { toast } = useToast();

  const [review, setReview] = useState<ContractReview | null>(null);
  const [anchors, setAnchors] = useState<MarkerAnchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [onlySignatureBlock, setOnlySignatureBlock] = useState(true);
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [dragSignType, setDragSignType] = useState<EcontractSignType | null>(null);
  const [hoverParaId, setHoverParaId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, list] = await Promise.all([
      getReviewById(id),
      getMarkerAnchors(id).catch(() => [] as MarkerAnchor[]),
    ]);
    setReview(r);
    setAnchors(list);
    setSelectedRecipientId(
      (prev) => prev || r.recipients.find(recipientNeedsMarker)?.id || ""
    );
    return r;
  }, [id]);

  useEffect(() => {
    if (!getSession()) {
      router.push("/login");
      return;
    }
    reload()
      .catch(() => toast({ title: "Không tải được ticket", variant: "destructive" }))
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
  const selected = useMemo(
    () => review?.recipients.find((r) => r.id === selectedRecipientId) ?? null,
    [review, selectedRecipientId]
  );

  /** paraId → người ký đang chiếm chỗ đó. */
  const placedBy = useMemo(() => {
    const map = new Map<string, SignRecipient>();
    for (const r of review?.recipients ?? []) {
      if (r.marker?.paraId) map.set(r.marker.paraId, r);
    }
    return map;
  }, [review]);

  const visibleAnchors = useMemo(
    () =>
      onlySignatureBlock ? anchors.filter((a) => a.recommended) : anchors,
    [anchors, onlySignatureBlock]
  );

  const place = async (
    anchor: MarkerAnchor,
    signType?: EcontractSignType,
    patch?: { sizePreset?: "default" | "large"; width?: number; height?: number }
  ) => {
    if (!review || !selectedRecipientId) {
      toast({
        title: "Chọn người ký trước",
        description: "Chọn Người ký / Văn thư ở cột trái rồi kéo loại ký vào đoạn cần đặt.",
        variant: "destructive",
      });
      return;
    }
    const preset =
      patch?.sizePreset ?? selected?.marker?.sizePreset ?? "default";
    setSaving(true);
    try {
      const updated = await placeMarkerOnDocument(review.id, selectedRecipientId, {
        anchor: { paraId: anchor.paraId, align: "center", position: "after" },
        signType: signType ?? selected?.signType,
        sizePreset: preset,
        width: patch?.width ?? selected?.marker?.width ?? SIZE[preset].width,
        height: patch?.height ?? selected?.marker?.height ?? SIZE[preset].height,
      });
      setReview(updated);
      toast({ title: "Đã đặt vị trí chữ ký", description: anchor.preview || "Đoạn trống" });
    } catch (e) {
      toast({
        title: "Không đặt được marker",
        description: e instanceof Error ? e.message : "Lỗi",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
      setDragSignType(null);
      setHoverParaId(null);
    }
  };

  const drop = async (anchor: MarkerAnchor, e: React.DragEvent) => {
    e.preventDefault();
    const signType = (e.dataTransfer.getData("signType") ||
      dragSignType) as EcontractSignType | null;
    await place(anchor, signType ?? undefined);
  };

  const clear = async (recipientId: string) => {
    if (!review) return;
    setSaving(true);
    try {
      setReview(await removeMarker(review.id, recipientId));
    } catch (e) {
      toast({
        title: "Không gỡ được marker",
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
      toast({ title: "Chưa đủ marker", description: errors[0], variant: "destructive" });
      return;
    }
    setPushing(true);
    try {
      const updated = await completeMarkersAndPushEcontract(review.id);
      setReview(updated);
      toast({
        title: "Đã Submit sang eContract",
        description:
          updated.econtract?.envelopeId ||
          updated.econtract?.message ||
          "Đang xếp hàng đồng bộ",
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Quay lại người ký
              </Link>
            </Button>
          </div>
          <ol className="flex flex-wrap gap-6 text-sm">
            {STEPS.map((item, index) => {
              const num = index + 1;
              if (item.kind === "link") {
                return (
                  <li key={item.id} className="relative pb-2">
                    <Link
                      href={`/dashboard/contracts/${review.id}`}
                      className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline"
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
              const active = item.id === "design";
              return (
                <li key={item.id} className="relative pb-2">
                  <span
                    className={
                      active ? "font-medium text-sky-700" : "text-muted-foreground/70"
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
          {/* ── Cột trái: loại ký + người cần marker ───────────────────── */}
          <aside className="w-60 shrink-0 space-y-3 overflow-y-auto border-r bg-white p-3">
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
                  className={`${p.color} select-none rounded-md px-3 py-3 text-white shadow-sm ${
                    canDesign ? "cursor-grab active:cursor-grabbing" : "opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {p.icon}
                    <span className="text-sm font-medium">{p.label}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t pt-2">
              <div className="text-xs font-semibold text-muted-foreground">
                Cần gán marker ({signers.length})
              </div>
              {signers.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRecipientId(r.id)}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                    selectedRecipientId === r.id
                      ? "border-sky-500 bg-sky-50"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-muted-foreground">
                    {UI_ROLE_LABEL[normalizeUiRole(r.ecRole)]} · {r.orgName}
                  </div>
                  {r.marker ? (
                    <Badge className="mt-1 text-[10px]" variant="secondary">
                      {r.marker.anchorPreview?.slice(0, 22) || "Đã đặt"}
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

          {/* ── Giữa: các đoạn văn thật của hợp đồng ───────────────────── */}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 border-b bg-white px-3 py-2 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={onlySignatureBlock}
                  onChange={(e) => setOnlySignatureBlock(e.target.checked)}
                />
                Chỉ hiện khối chữ ký
              </label>
              <span className="text-muted-foreground">
                {visibleAnchors.length} / {anchors.length} đoạn
              </span>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="mx-auto max-w-3xl rounded-md bg-white p-4 shadow-sm">
                {anchors.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Không đọc được đoạn nào từ tài liệu.
                  </p>
                )}
                <ul className="space-y-1">
                  {visibleAnchors.map((a) => {
                    const owner = placedBy.get(a.paraId);
                    const palette = PALETTE.find(
                      (p) => p.signType === owner?.signType
                    );
                    return (
                      <li
                        key={a.paraId}
                        onDragOver={(e) => {
                          if (!canDesign) return;
                          e.preventDefault();
                          setHoverParaId(a.paraId);
                        }}
                        onDragLeave={() => setHoverParaId(null)}
                        onDrop={canDesign ? (e) => drop(a, e) : undefined}
                        className={`flex items-start gap-2 rounded border px-2 py-1.5 text-[13px] transition-colors ${
                          hoverParaId === a.paraId
                            ? "border-sky-500 bg-sky-50"
                            : owner
                              ? "border-emerald-300 bg-emerald-50/60"
                              : a.recommended
                                ? "border-dashed border-slate-300"
                                : "border-transparent"
                        }`}
                      >
                        <span className="w-10 shrink-0 pt-0.5 text-right text-[10px] text-muted-foreground">
                          {a.ordinal}
                        </span>
                        <div className="min-w-0 flex-1">
                          {a.clause && (
                            <span className="mr-1 font-medium text-slate-500">
                              {a.clause}
                            </span>
                          )}
                          <span className={a.blank ? "italic text-muted-foreground" : ""}>
                            {a.preview || "(đoạn trống — chỗ đặt ô ký)"}
                          </span>
                          {owner && (
                            <div
                              className={`mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-white ${
                                palette?.color || "bg-sky-600"
                              }`}
                            >
                              {owner.name}
                              <button
                                type="button"
                                disabled={!canDesign || saving}
                                onClick={() => clear(owner.id)}
                                title="Gỡ ô ký"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                        {a.inTable && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            bảng
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </main>

          {/* ── Cột phải: thuộc tính ô ký đang chọn ─────────────────────── */}
          <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l bg-white p-3">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Người nhận
              </div>
              <select
                className="h-9 w-full rounded-md border px-2 text-sm"
                disabled={!canDesign}
                value={selectedRecipientId}
                onChange={(e) => setSelectedRecipientId(e.target.value)}
              >
                <option value="">— Chọn —</option>
                {signers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({UI_ROLE_LABEL[normalizeUiRole(r.ecRole)]})
                  </option>
                ))}
              </select>
            </div>

            {selected?.marker ? (
              <>
                <div className="rounded-md border bg-slate-50 p-2 text-xs">
                  <div className="font-semibold">Vị trí ô ký</div>
                  <div className="mt-1 text-muted-foreground">
                    {selected.marker.positionLabel || selected.marker.paraId}
                  </div>
                  {selected.marker.approximated && (
                    <div className="mt-2 flex items-start gap-1 text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Vị trí này do hệ thống suy ra, chưa neo vào đoạn cụ thể — kéo
                        thả lại để đặt chính xác.
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Kích thước
                  </div>
                  <div className="mb-2 flex gap-3 text-sm">
                    {(["default", "large"] as const).map((preset) => (
                      <label key={preset} className="inline-flex items-center gap-1.5">
                        <input
                          type="radio"
                          disabled={!canDesign || saving}
                          checked={
                            (selected.marker?.sizePreset ?? "default") === preset
                          }
                          onChange={() => {
                            const anchor = anchors.find(
                              (a) => a.paraId === selected.marker?.paraId
                            );
                            if (anchor) {
                              void place(anchor, selected.signType, {
                                sizePreset: preset,
                                ...SIZE[preset],
                              });
                            }
                          }}
                        />
                        {preset === "default" ? "Mặc định" : "Lớn"}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">Chiều rộng</Label>
                      <Input
                        readOnly
                        className="h-8"
                        value={selected.marker.width ?? SIZE.default.width}
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Chiều cao</Label>
                      <Input
                        readOnly
                        className="h-8"
                        value={selected.marker.height ?? SIZE.default.height}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Bề rộng ô ký là khoảng cách giữa hai dấu <code>#</code> của marker,
                    quy đổi ra khoảng trắng khi ghi vào tài liệu.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Chọn người ký rồi kéo một loại chữ ký vào đoạn văn ở giữa.
              </p>
            )}

            {review.econtract && (
              <div className="space-y-1 rounded-md border bg-slate-50 p-2 text-xs">
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

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-white px-4 py-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/contracts/${review.id}/identify-signers`}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Quay lại
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            {errors.length > 0 && (
              <span className="max-w-md truncate text-xs text-destructive">
                {errors[0]}
              </span>
            )}
            <Button
              size="sm"
              disabled={!canDesign || pushing || saving || errors.length > 0}
              onClick={handlePush}
            >
              {pushing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 h-3.5 w-3.5" />
              )}
              Submit
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
