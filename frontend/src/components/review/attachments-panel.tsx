"use client";

/**
 * Tệp đính kèm của các lượt duyệt — TH3.
 *
 * ## Vì sao phải có màn hình riêng cho việc này
 *
 * Blueprint A4 đòi *"file đính kèm phải lưu nội dung thật, Purchasing tải được"*.
 * Bản trước chỉ giữ `{name, size}` trong một cột JSON: người duyệt bấm đính kèm,
 * thấy tên tệp hiện lên, tưởng đã gửi — Purchasing mở ra thì không có gì để tải.
 * Hỏng im lặng, và cả hai phía đều không biết.
 *
 * ## Không phải PT3
 *
 * Tệp ở đây là **vật chứng của một ý kiến**, không phải bản mới của hợp đồng.
 * Nó không thay tài liệu, không bump version, không chạy lại AI, và **không** bị
 * đối chiếu cấu trúc — người duyệt hoàn toàn có quyền gửi kèm một bản đã sửa cả
 * vùng khoá để nói "tôi muốn Điều 3.5 thành thế này". Chặn họ ở đây là làm mất
 * đúng cái khoảng trống nghiệp vụ F6.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileUp, Loader2, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadFile } from "@/lib/api";
import { addAttachment, listAttachments } from "@/lib/services/reviews";
import type { AttachedFile } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  reviewId,
  canAttach,
  className,
}: {
  reviewId: string;
  canAttach: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AttachedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listAttachments(reviewId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách tệp");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upload = async (file: File) => {
    setBusy("upload");
    setError(null);
    try {
      await addAttachment(reviewId, file);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đính kèm được tệp");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (item: AttachedFile) => {
    setBusy(item.id);
    setError(null);
    try {
      await downloadFile(item.url, item.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được tệp");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Tệp đính kèm</span>
        {items.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {items.length}
          </Badge>
        )}
        <div className="flex-1" />
        {canAttach && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
            >
              {busy === "upload" ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <FileUp className="mr-1 h-3 w-3" />
              )}
              Đính kèm
            </Button>
          </>
        )}
      </div>

      {error && <p className="px-3 pt-2 text-xs text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có tệp nào.
            {canAttach
              ? " Gửi kèm bản đã sửa bằng Word, biên bản họp, hay email của nhà cung cấp."
              : ""}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-md border p-2 text-xs"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {humanSize(item.size)}
                    {item.uploadedAt
                      ? ` · ${new Date(item.uploadedAt).toLocaleString("vi-VN")}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-[11px]"
                  disabled={busy !== null}
                  onClick={() => download(item)}
                >
                  {busy === item.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
