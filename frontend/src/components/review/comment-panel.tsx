"use client";

/**
 * Panel bình luận 2 chiều (TH1).
 *
 * Ba điều panel này phải làm rõ trên màn hình, vì chúng là quyết định nghiệp vụ
 * chứ không phải chi tiết trình bày:
 *
 *  1. **Bình luận vào vùng KHOÁ là hợp lệ.** Hệ thống không ghi được vào đó,
 *     nhưng người duyệt vẫn phải nói được là muốn sửa gì. Ca thật: hợp đồng
 *     THACO, người duyệt yêu cầu sửa Điều 3.5 và 3.6 — cả hai đều bị khoá.
 *  2. **Thread mất neo thì nói ra.** Tài liệu đổi ⇒ trạng thái `orphaned` kèm
 *     lý do, và vẫn giữ trích dẫn cũ để đọc lại được thảo luận.
 *  3. **Đóng thread không đổi trạng thái ticket** (quy tắc A4b). UI nói thẳng
 *     điều đó để người duyệt không tưởng mình vừa trả hồ sơ về Purchasing.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  MessageSquarePlus,
  Send,
  Unlock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createComment,
  listComments,
  replyComment,
  resolveComment,
} from "@/lib/services/reviews";
import type { CommentThread, EditableField } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

type Filter = "open" | "all";

/** Giá trị giả trong dropdown, trỏ tới đoạn đang bôi đen thay vì một vùng mở. */
const ANCHOR_SELECTION = "__selection__";

export function CommentPanel({
  reviewId,
  fields,
  canComment,
  documentSelection,
  className,
}: {
  reviewId: string;
  /** Vùng của tài liệu — dùng để chọn chỗ neo khi mở thread mới. */
  fields: EditableField[];
  canComment: boolean;
  /**
   * Đoạn đang được bôi đen trên tài liệu (SuperDoc).
   *
   * Có nó thì neo được vào ĐÚNG đoạn người ta đang đọc, kể cả đoạn thuộc vùng
   * khoá — mà đó lại chính là ca thật hay gặp nhất: hợp đồng THACO, người duyệt
   * yêu cầu sửa Điều 3.5 và 3.6, cả hai khoá 100% nên không có trong danh sách
   * vùng mở của dropdown.
   */
  documentSelection?: { paraId: string; paragraphText: string } | null;
  className?: string;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [anchorId, setAnchorId] = useState("");
  const [draft, setDraft] = useState("");

  const reload = useCallback(async () => {
    try {
      setThreads(await listComments(reviewId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được bình luận");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(
    () => (filter === "open" ? threads.filter((t) => t.status !== "resolved") : threads),
    [threads, filter]
  );
  const openCount = threads.filter((t) => t.status === "open").length;
  const orphanCount = threads.filter((t) => t.status === "orphaned").length;

  const submitNew = async () => {
    if (!draft.trim()) return;
    // Neo vào đoạn đang chọn được ưu tiên: nó cụ thể hơn một vùng mở, và là
    // cách duy nhất neo được vào đoạn thuộc vùng khoá.
    const anchor =
      anchorId === ANCHOR_SELECTION && documentSelection
        ? { paraId: documentSelection.paraId }
        : fields.find((f) => f.id === anchorId)
          ? { permId: anchorId }
          : null;
    if (!anchor) return;
    setBusyId("new");
    try {
      await createComment(reviewId, anchor, draft.trim());
      setDraft("");
      setComposing(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được bình luận");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          Bình luận
          {openCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {openCount} đang mở
            </Badge>
          )}
          {orphanCount > 0 && (
            <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">
              {orphanCount} mất neo
            </Badge>
          )}
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => setFilter((f) => (f === "open" ? "all" : "open"))}
        >
          {filter === "open" ? "Hiện cả đã đóng" : "Chỉ đang mở"}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
          </div>
        )}
        {error && (
          <p className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {!loading && visible.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có bình luận nào.
          </p>
        )}

        {visible.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            reviewId={reviewId}
            canComment={canComment}
            busy={busyId === thread.id}
            onBusy={setBusyId}
            onChanged={reload}
            onError={setError}
          />
        ))}
      </div>

      {canComment && (
        <div className="shrink-0 border-t p-3">
          {composing ? (
            <div className="space-y-2">
              <select
                className="h-9 w-full rounded-md border px-2 text-sm"
                value={anchorId}
                onChange={(e) => setAnchorId(e.target.value)}
              >
                <option value="">— Chọn vùng cần bình luận —</option>
                {documentSelection && (
                  <option value={ANCHOR_SELECTION}>
                    ✻ Đoạn đang chọn trên tài liệu
                  </option>
                )}
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.locked ? "🔒 " : ""}
                    {f.label}
                  </option>
                ))}
              </select>
              {anchorId === ANCHOR_SELECTION && documentSelection && (
                <p className="rounded border-l-2 border-primary/40 bg-muted/50 px-2 py-1 text-[11px] italic text-muted-foreground line-clamp-3">
                  {documentSelection.paragraphText}
                </p>
              )}
              <textarea
                className="min-h-[72px] w-full rounded-md border px-2 py-1.5 text-sm"
                placeholder="Nội dung bình luận…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setComposing(false)}>
                  Huỷ
                </Button>
                <Button
                  size="sm"
                  disabled={!anchorId || !draft.trim() || busyId === "new"}
                  onClick={submitNew}
                >
                  {busyId === "new" ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1 h-3.5 w-3.5" />
                  )}
                  Gửi
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setAnchorId(documentSelection ? ANCHOR_SELECTION : "");
                setComposing(true);
              }}
            >
              <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
              {documentSelection
                ? "Bình luận về đoạn đang chọn"
                : "Bình luận về một vùng"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  reviewId,
  canComment,
  busy,
  onBusy,
  onChanged,
  onError,
}: {
  thread: CommentThread;
  reviewId: string;
  canComment: boolean;
  busy: boolean;
  onBusy: (id: string | null) => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [reply, setReply] = useState("");
  const orphaned = thread.status === "orphaned";
  const resolved = thread.status === "resolved";

  const act = async (fn: () => Promise<unknown>) => {
    onBusy(thread.id);
    try {
      await fn();
      setReply("");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Thao tác không thành công");
    } finally {
      onBusy(null);
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border p-2 text-sm",
        orphaned && "border-amber-300 bg-amber-50/50",
        resolved && "opacity-60"
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {thread.anchorKind === "field" ? (
              <Unlock className="h-3 w-3" />
            ) : (
              <Lock className="h-3 w-3" />
            )}
            {thread.citation || (thread.anchorKind === "field" ? "Vùng mở" : "Đoạn khoá")}
          </span>
          <span className="mx-1">·</span>
          <span>bản v{thread.versionNo}</span>
        </div>
        {resolved && (
          <Badge variant="secondary" className="text-[10px]">
            Đã đóng
          </Badge>
        )}
      </div>

      {thread.quotedText && (
        <p className="mb-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">
          {thread.quotedText.slice(0, 180)}
          {thread.quotedText.length > 180 ? "…" : ""}
        </p>
      )}

      {orphaned && (
        <p className="mb-2 flex items-start gap-1 rounded bg-amber-100/70 p-1.5 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Mất neo: {thread.orphanReason}. Trích dẫn ở trên là nội dung tại thời
            điểm bình luận.
          </span>
        </p>
      )}

      <div className="space-y-2">
        {thread.replies.map((r) => (
          <div key={r.id} className="rounded bg-muted/60 px-2 py-1.5">
            <div className="text-[11px] text-muted-foreground">
              {r.authorName} · {r.authorRole}
            </div>
            <p className="whitespace-pre-wrap text-[13px]">{r.content}</p>
          </div>
        ))}
      </div>

      {canComment && !resolved && (
        <div className="mt-2 flex items-start gap-2">
          <textarea
            className="min-h-[36px] flex-1 rounded-md border px-2 py-1 text-[13px]"
            placeholder="Trả lời…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !reply.trim()}
              onClick={() => act(() => replyComment(reviewId, thread.id, reply.trim()))}
              title="Gửi trả lời"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act(() => resolveComment(reviewId, thread.id))}
              // Nói thẳng: đóng thread KHÔNG trả hồ sơ về Purchasing (A4b)
              title="Đóng thread — không đổi trạng thái hợp đồng"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
