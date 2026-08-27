"use client";

/**
 * PT3 — tải `.docx` về, sửa bằng Word, upload lại.
 *
 * Hai bước trong một hộp thoại, cố ý theo đúng thứ tự người ta thật sự làm: tải
 * **bản mới nhất** rồi mới sửa. Tách thành hai chỗ khác nhau trên giao diện là mở
 * đường cho người dùng sửa một bản đã cũ, và bản cũ chắc chắn lệch cấu trúc so
 * với bản hệ thống đang giữ — họ sẽ nhận một danh sách lỗi mà không hiểu vì sao.
 *
 * ## Điều hộp thoại này phải nói thẳng
 *
 * PT3 là **vòng review mới**, không phải một lần lưu. Version tăng, kết quả AI cũ
 * bị xoá và AI chạy lại từ đầu — vì những kết luận đó nói về một tệp không còn
 * tồn tại. Người dùng phải biết trước khi bấm, không phải phát hiện sau.
 *
 * ## Vì sao không validate ở đây rồi tin kết quả đó
 *
 * Backend kiểm hai lớp và chặn cứng (ràng buộc C-4, **không có override**). Lớp
 * kiểm phía FE chỉ để báo sớm cho người dùng; nếu backend dựa vào nó thì bypass
 * FE là bypass cả mô hình an toàn.
 */

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { downloadFile } from "@/lib/api";
import {
  ReuploadValidationError,
  formatIssueMessage,
  reuploadSubmit,
  type FieldStructureIssue,
} from "@/lib/services/reviews";
import type { ContractReview } from "@/lib/domain/types";

export function OfflineEditDialog({
  review,
  open,
  onOpenChange,
  onDone,
}: {
  review: ContractReview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (review: ContractReview) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"download" | "upload" | null>(null);
  const [issues, setIssues] = useState<FieldStructureIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const docUrl = review.reviewedDocxUrl || review.originalDocxUrl;

  const reset = () => {
    setFile(null);
    setNote("");
    setIssues([]);
    setError(null);
  };

  const download = async () => {
    if (!docUrl) return;
    setBusy("download");
    setError(null);
    try {
      await downloadFile(docUrl, review.fileName || `${review.code}.docx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được tệp");
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy("upload");
    setIssues([]);
    setError(null);
    try {
      const updated = await reuploadSubmit(review.id, file, note.trim());
      onDone(updated);
      reset();
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ReuploadValidationError) {
        setIssues(e.issues);
      } else {
        setError(e instanceof Error ? e.message : "Không upload được tệp");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sửa offline bằng Word</DialogTitle>
          <DialogDescription>
            Tải bản mới nhất về, sửa các vùng được mở bằng Microsoft Word, rồi
            upload lại.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bước 1 */}
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">
              1. Tải bản mới nhất (v{review.version})
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={download}
              disabled={!docUrl || busy !== null}
            >
              {busy === "download" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              Tải {review.fileName || "tài liệu"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Phải sửa trên đúng bản này. Sửa một bản đã cũ thì cấu trúc sẽ lệch
              và hệ thống từ chối.
            </p>
          </div>

          {/* Bước 2 */}
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm font-medium">2. Upload bản đã sửa</p>
            <input
              ref={inputRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setIssues([]);
                setError(null);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={busy !== null}
              >
                <FileUp className="mr-1.5 h-3.5 w-3.5" />
                Chọn tệp .docx
              </Button>
              {file && (
                <span className="truncate text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </span>
              )}
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú cho version này (tuỳ chọn)"
              className="mt-2 h-9 w-full rounded-md border px-2 text-sm"
            />
          </div>

          {/* Cảnh báo: đây là vòng review mới, không phải một lần lưu */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-medium">Upload lại là một vòng review mới</p>
            <p className="mt-1">
              Version tăng lên v{review.version + 1}, toàn bộ kết quả AI của vòng
              này bị xoá và AI chạy lại từ đầu. Đề xuất chưa áp sẽ mất — chúng
              nói về bản tài liệu cũ.
            </p>
          </div>

          {/* Lỗi cấu trúc — chặn cứng, không có nút bỏ qua */}
          {issues.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" />
                Tệp bị từ chối — {issues.length} điểm không khớp
              </p>
              <ul className="mt-2 space-y-1.5">
                {issues.map((issue, i) => (
                  <li key={i} className="text-xs text-destructive/90">
                    • {formatIssueMessage(issue)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Vùng khoá của hợp đồng không được phép thay đổi. Không có cách bỏ
                qua kiểm tra này — hãy tải lại bản mới nhất và chỉ sửa các vùng
                được mở.
              </p>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy !== null}
          >
            Huỷ
          </Button>
          <Button onClick={upload} disabled={!file || busy !== null}>
            {busy === "upload" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Upload lại và chạy AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
