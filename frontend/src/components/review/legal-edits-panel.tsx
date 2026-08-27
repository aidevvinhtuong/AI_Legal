"use client";

/**
 * Panel đề xuất chỉnh sửa của người duyệt — TH2.
 *
 * Ba điều panel này phải nói rõ, vì đều là quyết định nghiệp vụ:
 *
 *  1. **Lớp diff này TÁCH khỏi diff của AI.** Blueprint yêu cầu vậy. Trên màn
 *     hình phải thấy ngay ai đề xuất: tên người duyệt, không phải "AI".
 *  2. **Đề xuất chạm vùng khoá vẫn hiện ra.** Nó không áp được, nhưng vứt đi là
 *     làm mất một yêu cầu của người có thẩm quyền. Ca thật: hợp đồng THACO,
 *     người duyệt đề nghị thay hẳn văn bản Điều 3.5 — vùng khoá 100%. Đường đi
 *     của những đề xuất này là escalate cho Legal sửa template.
 *  3. **Áp đề xuất là GHI TÀI LIỆU**, sinh version mới. Nút phải nằm ở phía
 *     Purchasing, và backend tự chặn nếu người bấm không có quyền sửa.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Lock,
  Loader2,
  PenLine,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  decideLegalEdit,
  listLegalEdits,
  submitLegalEdits,
  type LegalEditDraft,
} from "@/lib/services/reviews";
import type { ContractReview, LegalEdit } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<LegalEdit["kind"], string> = {
  insert: "Thêm",
  delete: "Xoá",
  replace: "Sửa",
  format: "Định dạng",
};

export function LegalEditsPanel({
  reviewId,
  /** Đọc track changes hiện có trong editor. `null` = không ở chế độ đề xuất. */
  collectSuggestions,
  /** Chủ ticket mới được áp đề xuất vào tài liệu. */
  canApply,
  onReviewUpdated,
  className,
}: {
  reviewId: string;
  collectSuggestions?: (() => LegalEditDraft[]) | null;
  canApply?: boolean;
  onReviewUpdated?: (review: ContractReview) => void;
  className?: string;
}) {
  const [edits, setEdits] = useState<LegalEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEdits(await listLegalEdits(reviewId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được đề xuất");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pending = useMemo(() => edits.filter((e) => e.status === "pending"), [edits]);
  const blocked = useMemo(
    () => pending.filter((e) => e.target === "locked"),
    [pending]
  );

  const submit = async () => {
    if (!collectSuggestions) return;
    const drafts = collectSuggestions();
    if (!drafts.length) {
      setNotice("Chưa có thay đổi nào trong tài liệu để gửi.");
      return;
    }
    setBusyId("submit");
    setNotice(null);
    try {
      setEdits(await submitLegalEdits(reviewId, drafts));
      setError(null);
      setNotice(`Đã gửi ${drafts.length} đề xuất.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được đề xuất");
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (edit: LegalEdit, action: "apply" | "reject") => {
    setBusyId(edit.id);
    setNotice(null);
    try {
      const result = await decideLegalEdit(reviewId, edit.id, action);
      setEdits(result.edits);
      setError(null);
      if (action === "apply" && result.review) onReviewUpdated?.(result.review);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xử lý được đề xuất");
      // Đề xuất có thể vừa chuyển sang mồ côi ở server — đọc lại cho khớp
      void reload();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <PenLine className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Đề xuất của người duyệt</span>
        {pending.length > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {pending.length} chờ xử lý
          </Badge>
        )}
        <div className="flex-1" />
        {collectSuggestions && (
          <Button size="sm" onClick={submit} disabled={busyId === "submit"}>
            {busyId === "submit" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1 h-3.5 w-3.5" />
            )}
            Gửi đề xuất
          </Button>
        )}
      </div>

      {blocked.length > 0 && (
        <div className="m-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">
              {blocked.length} đề xuất chạm vào vùng Legal khoá
            </p>
            <p className="mt-1">
              Hệ thống không ghi vào vùng khoá trong bất kỳ trường hợp nào. Những
              yêu cầu này cần chuyển Legal xem xét sửa template hoặc lập phụ lục.
            </p>
          </div>
        </div>
      )}

      {notice && (
        <p className="px-3 pt-2 text-xs text-muted-foreground">{notice}</p>
      )}
      {error && (
        <p className="px-3 pt-2 text-xs text-destructive">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải…
          </div>
        ) : edits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Chưa có đề xuất nào. Người duyệt sửa trực tiếp trên tài liệu ở chế độ
            đề xuất, rồi bấm <span className="font-medium">Gửi đề xuất</span>.
          </p>
        ) : (
          <ul className="space-y-2">
            {edits.map((edit) => (
              <EditCard
                key={edit.id}
                edit={edit}
                busy={busyId === edit.id}
                canApply={!!canApply}
                onDecide={decide}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EditCard({
  edit,
  busy,
  canApply,
  onDecide,
}: {
  edit: LegalEdit;
  busy: boolean;
  canApply: boolean;
  onDecide: (edit: LegalEdit, action: "apply" | "reject") => void;
}) {
  const locked = edit.target === "locked";
  const pending = edit.status === "pending";

  return (
    <li
      className={cn(
        "rounded-md border p-3 text-xs",
        locked && pending && "border-amber-300 bg-amber-50/50",
        edit.status === "applied" && "border-emerald-200 bg-emerald-50/40",
        edit.status === "rejected" && "opacity-60",
        edit.status === "orphaned" && "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          {KIND_LABEL[edit.kind]}
        </Badge>
        {edit.citation && (
          <span className="font-medium text-foreground">{edit.citation}</span>
        )}
        {locked && (
          <Badge className="gap-1 bg-amber-600 text-[10px] hover:bg-amber-600">
            <Lock className="h-2.5 w-2.5" />
            Vùng khoá
          </Badge>
        )}
        {edit.status !== "pending" && (
          <Badge variant="secondary" className="text-[10px]">
            {edit.status === "applied"
              ? "Đã áp"
              : edit.status === "rejected"
                ? "Đã bỏ"
                : "Mất neo"}
          </Badge>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {edit.authorName} · {edit.authorRole}
        </span>
      </div>

      {/* Chỉ hiện mẩu đã đổi. Bắt người đọc tự dò trong hai đoạn dài giống hệt
          nhau là cách chắc chắn khiến họ bấm Áp mà không đọc. */}
      <div className="space-y-1 rounded bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
        {edit.removedText && (
          <p className="text-destructive line-through decoration-destructive/50">
            {edit.removedText}
          </p>
        )}
        {edit.addedText && (
          <p className="text-emerald-700">{edit.addedText}</p>
        )}
      </div>

      {edit.blockedReason && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {edit.blockedReason}
        </p>
      )}

      {pending && (
        <div className="mt-2 flex gap-1.5">
          {canApply && !locked && (
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={busy}
              onClick={() => onDecide(edit, "apply")}
            >
              {busy ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Check className="mr-1 h-3 w-3" />
              )}
              Áp vào tài liệu
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            disabled={busy}
            onClick={() => onDecide(edit, "reject")}
          >
            <X className="mr-1 h-3 w-3" />
            Bỏ qua
          </Button>
        </div>
      )}
    </li>
  );
}
