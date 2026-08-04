"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { SignRecipient } from "@/lib/types";
import { buildMarkerSyntax } from "@/lib/review-service";
import { MapPin } from "lucide-react";

const POSITIONS = [
  "Cuối trang chữ ký — Bên A",
  "Cuối trang chữ ký — Bên B",
  "Phụ lục 1 — khối chữ ký",
  "Trang bìa — góc phải",
];

export function MarkerPanel({
  recipients,
  onAssign,
  errors,
  readOnly,
}: {
  recipients: SignRecipient[];
  onAssign: (recipientId: string, positionLabel: string) => void;
  errors: string[];
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Gán marker ký số (bắt buộc trước Legal)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          UI kéo-thả/click sinh marker theo chuẩn Econtract — không cần gõ tay cú pháp.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-1">
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {recipients.map((r) => (
          <div key={r.id} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  role: {r.role} · marker: {r.markerType}
                </div>
              </div>
              {r.marker ? (
                <Badge>Đã gán</Badge>
              ) : (
                <Badge variant="outline">Thiếu</Badge>
              )}
            </div>

            {r.marker ? (
              <div className="text-xs font-mono bg-muted rounded px-2 py-1.5 break-all">
                {buildMarkerSyntax(r)}
                <div className="text-muted-foreground mt-1 font-sans">
                  Vị trí: {r.marker.positionLabel}
                </div>
              </div>
            ) : (
              !readOnly && (
                <div className="flex flex-wrap gap-2">
                  {POSITIONS.map((pos) => (
                    <Button
                      key={pos}
                      size="sm"
                      variant="outline"
                      onClick={() => onAssign(r.id, pos)}
                    >
                      <MapPin className="h-3.5 w-3.5 mr-1" />
                      {pos}
                    </Button>
                  ))}
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
