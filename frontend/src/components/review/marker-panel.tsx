"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ContractReview,
  EcontractSignType,
  SignRecipient,
} from "@/lib/types";
import {
  buildEcontractPayload,
  buildMarkerSyntax,
  recipientNeedsMarker,
} from "@/lib/review-service";
import { Building2, ChevronDown, ChevronRight, Eye, MapPin } from "lucide-react";

const POSITIONS = [
  "Cuối trang chữ ký — Bên A",
  "Cuối trang chữ ký — Bên B",
  "Phụ lục 1 — khối chữ ký",
  "Trang bìa — góc phải",
];

const SIGN_TYPE_OPTIONS: { value: EcontractSignType; label: string }[] = [
  { value: "review", label: "Người xem xét (không marker)" },
  { value: "sign_img", label: "Ký điện tử — ký ảnh (is)" },
  { value: "sign_fca.passcode", label: "Chữ ký số passcode (ds)" },
  { value: "sign_ekyc", label: "Ký số eKYC / OTP (ds)" },
];

function RecipientCard({
  r,
  readOnly,
  onAssign,
  onUpdate,
}: {
  r: SignRecipient;
  readOnly?: boolean;
  onAssign: (recipientId: string, positionLabel: string, height: number) => void;
  onUpdate: (recipientId: string, patch: Partial<SignRecipient>) => void;
}) {
  const [height, setHeight] = useState(r.marker?.height ?? 100);
  const isText = r.markerType === "st";
  const needsMarker = recipientNeedsMarker(r);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {isText ? `st → r:${r.refRecipientId ?? "?"}` : r.id}
          </div>
        </div>
        {!needsMarker ? (
          <Badge variant="secondary" className="gap-1">
            <Eye className="h-3 w-3" /> Reviewer
          </Badge>
        ) : r.marker ? (
          <Badge>Đã gán</Badge>
        ) : (
          <Badge variant="outline">Thiếu marker</Badge>
        )}
      </div>

      {!isText && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Email người ký *</Label>
            <Input
              value={r.email || ""}
              disabled={readOnly}
              placeholder="email@congty.com"
              className="h-8 text-xs"
              onChange={(e) => onUpdate(r.id, { email: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Hình thức ký</Label>
            <Select
              value={r.signType || ""}
              onValueChange={(v) =>
                onUpdate(r.id, { signType: v as EcontractSignType })
              }
              disabled={readOnly}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Chọn hình thức ký" />
              </SelectTrigger>
              <SelectContent>
                {SIGN_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {needsMarker &&
        (r.marker ? (
          <div className="text-xs font-mono bg-muted rounded px-2 py-1.5 break-all">
            {buildMarkerSyntax(r)}
            <div className="text-muted-foreground mt-1 font-sans">
              Vị trí: {r.marker.positionLabel} · h:{r.marker.height} · chèn bằng
              mực trắng để ẩn marker
            </div>
          </div>
        ) : (
          !readOnly && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-[11px] text-muted-foreground shrink-0">
                  Chiều cao ô ký (h)
                </Label>
                <Input
                  type="number"
                  min={20}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value) || 100)}
                  className="h-8 w-24 text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {POSITIONS.map((pos) => (
                  <Button
                    key={pos}
                    size="sm"
                    variant="outline"
                    onClick={() => onAssign(r.id, pos, height)}
                  >
                    <MapPin className="h-3.5 w-3.5 mr-1" />
                    {pos}
                  </Button>
                ))}
              </div>
            </div>
          )
        ))}
    </div>
  );
}

export function MarkerPanel({
  review,
  recipients,
  onAssign,
  onUpdateRecipient,
  errors,
  readOnly,
}: {
  review?: ContractReview;
  recipients: SignRecipient[];
  onAssign: (recipientId: string, positionLabel: string, height: number) => void;
  onUpdateRecipient: (
    recipientId: string,
    patch: Partial<SignRecipient>
  ) => void;
  errors: string[];
  readOnly?: boolean;
}) {
  const [showPayload, setShowPayload] = useState(false);

  const parties = useMemo(() => {
    const map = new Map<
      string,
      { partyId: string; orgName: string; isMyOrg: boolean; items: SignRecipient[] }
    >();
    for (const r of recipients) {
      const pid = r.partyId || "p_khac";
      if (!map.has(pid)) {
        map.set(pid, {
          partyId: pid,
          orgName: r.orgName || "(chưa có orgName)",
          isMyOrg: r.isMyOrg ?? false,
          items: [],
        });
      }
      map.get(pid)!.items.push(r);
    }
    return Array.from(map.values());
  }, [recipients]);

  const payloadJson = useMemo(
    () => (review ? JSON.stringify(buildEcontractPayload(review), null, 2) : ""),
    [review]
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">
          Gán marker ký số (bắt buộc trước Legal)
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cú pháp FPT.eContract: <code>#ds:id r:p_001_r_001 h:100 #</code> —
          khoảng cách <code>#…#</code> là chiều rộng ô ký; hệ thống sinh marker,
          không cần gõ tay. Người xem xét (reviewer) không có marker.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
          <div className="font-semibold">
            Lỗi validate (theo bảng mã lỗi eContract):
          </div>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {parties.map((p) => (
          <div key={p.partyId} className="space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{p.orgName}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {p.partyId}
              </span>
              {p.isMyOrg && (
                <Badge variant="secondary" className="text-[10px]">
                  Tổ chức mình
                </Badge>
              )}
            </div>
            <div className="space-y-2 pl-1">
              {p.items.map((r) => (
                <RecipientCard
                  key={r.id}
                  r={r}
                  readOnly={readOnly}
                  onAssign={onAssign}
                  onUpdate={onUpdateRecipient}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {review && (
        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-muted/50"
            onClick={() => setShowPayload((v) => !v)}
          >
            {showPayload ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Preview payload eContract (API khởi tạo HĐ — mục 3.1.2)
          </button>
          {showPayload && (
            <pre className="max-h-80 overflow-auto border-t bg-muted/40 p-3 text-[11px] leading-relaxed">
              {payloadJson}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
