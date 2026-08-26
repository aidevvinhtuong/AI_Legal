"use client";

/**
 * Nhúng `.docx` bằng SuperDoc — hiển thị, chọn đoạn, và đề xuất track changes.
 *
 * ## Ba chế độ
 *
 *   `viewing`     xem + BÔI CHỌN được (để neo bình luận TH1)
 *   `suggesting`  người duyệt sửa trực tiếp, SuperDoc ghi thành track changes (TH2)
 *
 * ## Quy tắc cứng: KHÔNG BAO GIỜ export từ đây
 *
 * PoC đo trên template HDDV thật: SuperDoc round-trip làm **mất một
 * `w:permEnd`** (15 permStart / 14 permEnd), khiến vùng mở #5 nuốt phần còn lại
 * của tài liệu — **110 trong 112 đoạn khoá biến thành mở**. Đó là ràng buộc C-3
 * sụp đổ hoàn toàn.
 *
 * Nên component này không bao giờ gọi `superdoc.export()` và không gửi file lên
 * server. Ở chế độ `suggesting`, cái được gửi đi là **văn bản đoạn trước/sau**,
 * còn việc ghi vào tài liệu do backend làm, qua allow-list Lớp 1.
 *
 * ## Vì sao phải bật `allowSelectionInViewMode`
 *
 * Đọc trong bundle 1.46.2: ở `viewing` mode mà cờ này tắt thì mọi lần đổi vùng
 * chọn đều bị `resetSelection()` — người dùng không bôi đen nổi một chữ. Thiếu
 * nó thì TH1 (neo bình luận vào đoạn đang chọn) không làm được.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { fetchBinary } from "@/lib/api";
import { cn } from "@/lib/utils";

// Style của SuperDoc — import tĩnh để Next bundle cùng trang
import "@harbour-enterprises/superdoc/style.css";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Tên mark track changes trong schema của SuperDoc. */
const MARK_INSERT = "trackInsert";
const MARK_DELETE = "trackDelete";
const MARK_FORMAT = "trackFormat";

/**
 * Node không phải text nhưng backend VẪN tính là ký tự.
 *
 * `run_text()` trong `services/document/ooxml.py` quy ước:
 *   `w:tab` → "\t" · `w:br`/`w:cr` → "\n"
 *
 * Còn SuperDoc dựng chúng thành node riêng (`tab`, `hardBreak`) và text của
 * chúng rỗng. Bỏ qua là hai bên lệch nhau — mà backend đối chiếu `before` bằng
 * **SHA-256 văn bản nguyên vẹn**, nên lệch một ký tự là đề xuất bị từ chối.
 *
 * Đo trên template HDDV thật: **16/197 đoạn** lệch đúng vì lý do này, trong đó
 * có "Đợt 1: Bên Sử Dụng sẽ đặt cọc ___% Phí Dịch Vụ…" — Điều 4 Thanh toán, nơi
 * người duyệt hay sửa nhất. Không phải ca hiếm.
 *
 * Quan trọng hơn cả việc khớp SHA: **offset**. Thiếu một ký tự tab thì mọi vị
 * trí sau đó lệch một, và mẩu sửa sẽ bị ghi sai chỗ bên trong vùng mở.
 */
const NODE_AS_TEXT: Record<string, string> = {
  tab: "\t",
  hardBreak: "\n",
};

export type SuperDocMode = "viewing" | "suggesting";

/** Đoạn đang được trỏ tới trong tài liệu. `paraId` = `w14:paraId`. */
export interface DocSelection {
  paraId: string;
  /** Toàn văn đoạn — dùng làm trích dẫn khi mở thread bình luận. */
  paragraphText: string;
  /** Phần đang bôi đen, rỗng nếu chỉ đặt con trỏ. */
  selectedText: string;
}

/** Một đề xuất sửa đọc ra từ track changes, gom theo ĐOẠN. */
export interface SuggestionDraft {
  paraId: string;
  kind: "insert" | "delete" | "replace" | "format";
  before: string;
  after: string;
}

export interface SuperDocHandle {
  /** Đoạn đang chọn, `null` nếu chưa đặt con trỏ vào tài liệu. */
  getSelection: () => DocSelection | null;
  /** Mọi thay đổi track changes hiện có, gom theo đoạn. */
  collectSuggestions: () => SuggestionDraft[];
}

/* ────────────────────────────────────────────────────────────────────────────
   Kiểu tối thiểu của ProseMirror mà component này chạm tới.
   SuperDoc không xuất khai báo type, nên khai đúng phần dùng còn hơn `any` trần
   — sai tên thuộc tính sẽ lộ ra lúc biên dịch thay vì lúc chạy.
   ──────────────────────────────────────────────────────────────────────────── */
interface PmNode {
  type: { name: string };
  attrs?: Record<string, unknown>;
  isText?: boolean;
  text?: string;
  textContent: string;
  marks: { type: { name: string } }[];
  descendants: (fn: (node: PmNode, pos: number) => boolean | void) => void;
}
interface PmResolvedPos {
  depth: number;
  node: (depth: number) => PmNode;
}
interface PmState {
  doc: PmNode & { textBetween: (from: number, to: number, sep?: string) => string };
  selection: { from: number; to: number; $from: PmResolvedPos };
}
interface PmEditor {
  state?: PmState;
}
interface SuperDocInstance {
  activeEditor?: PmEditor | null;
  destroy?: () => void;
}

/**
 * Cắt tiền tố + hậu tố chung, trả `[old, new]`.
 *
 * Cùng thuật toán với `changed_span()` ở backend — nhãn "chèn/xoá/sửa" hiện
 * trên UI phải khớp với cái backend kết luận, nếu không người duyệt thấy một
 * đằng mà hệ thống ghi một nẻo. Cắt hậu tố phải dừng trước tiền tố, nếu không
 * hai đầu ăn lẫn nhau khi chuỗi lặp ("aaa" → "aaaa").
 */
function changedSpan(before: string, after: string): [string, string] {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;

  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }
  return [before.slice(start, endB), after.slice(start, endA)];
}

function classify(before: string, after: string): SuggestionDraft["kind"] {
  const [removed, added] = changedSpan(before, after);
  if (!removed && added) return "insert";
  if (removed && !added) return "delete";
  return "replace";
}


/**
 * Text của một đoạn theo **đúng quy ước của backend** — kể cả tab và xuống dòng.
 *
 * Xem `NODE_AS_TEXT` để biết vì sao không dùng `node.textContent`.
 */
function paragraphText(node: PmNode): string {
  let out = "";
  node.descendants((child) => {
    if (child.isText && typeof child.text === "string") out += child.text;
    else out += NODE_AS_TEXT[child.type.name] ?? "";
    return true;
  });
  return out;
}

export const SuperDocEmbed = forwardRef<
  SuperDocHandle,
  {
    src: string;
    fileName?: string;
    className?: string;
    mode?: SuperDocMode;
    /** Ẩn thanh công cụ — dùng cho khung xem nhỏ. */
    hideToolbar?: boolean;
    onReady?: () => void;
    /** Gọi mỗi khi vùng chọn đổi, để nút "Bình luận đoạn này" bật/tắt đúng lúc. */
    onSelectionChange?: (selection: DocSelection | null) => void;
  }
>(function SuperDocEmbed(
  {
    src,
    fileName = "contract.docx",
    className,
    mode = "viewing",
    hideToolbar = false,
    onReady,
    onSelectionChange,
  },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<SuperDocInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `useId()` sinh chuỗi có dấu ":" — hợp lệ cho id nhưng KHÔNG hợp lệ trong
  // selector CSS, mà SuperToolbar chỉ nhận selector dạng chuỗi.
  const rawId = useId().replace(/:/g, "");
  const toolbarId = `sd-toolbar-${rawId}`;

  /** Editor ProseMirror đang hoạt động, `null` nếu tài liệu chưa mở xong. */
  const editor = useCallback((): PmEditor | null => {
    return instanceRef.current?.activeEditor ?? null;
  }, []);

  const readSelection = useCallback((): DocSelection | null => {
    const state = editor()?.state;
    if (!state) return null;
    const { $from, from, to } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth);
      if (node.type.name !== "paragraph") continue;
      const paraId = String(node.attrs?.paraId ?? "");
      if (!paraId) return null; // đoạn do SuperDoc tự sinh, không neo được
      return {
        paraId,
        // KHÔNG dùng `node.textContent`: nó bỏ qua tab/xuống dòng, nên trích dẫn
        // hiện trên bình luận sẽ khác nội dung backend lưu.
        paragraphText: paragraphText(node),
        selectedText: from === to ? "" : state.doc.textBetween(from, to, " "),
      };
    }
    return null;
  }, [editor]);

  /**
   * Đọc track changes ra thành đề xuất cấp đoạn.
   *
   * Mô hình của SuperDoc: chữ mới mang mark `trackInsert`, chữ bị xoá vẫn nằm
   * trong tài liệu nhưng mang `trackDelete`. Nên dựng lại được cả hai phía chỉ
   * bằng một lượt duyệt:
   *
   *   before = mọi text node KHÔNG mang trackInsert   (bản gốc)
   *   after  = mọi text node KHÔNG mang trackDelete   (bản sau khi áp)
   */
  const collectSuggestions = useCallback((): SuggestionDraft[] => {
    const state = editor()?.state;
    if (!state) return [];

    const out: SuggestionDraft[] = [];
    state.doc.descendants((node) => {
      if (node.type.name !== "paragraph") return true;

      const paraId = String(node.attrs?.paraId ?? "");
      if (!paraId) return false;

      let before = "";
      let after = "";
      let touched = false;

      node.descendants((child) => {
        const literal =
          child.isText && typeof child.text === "string"
            ? child.text
            : NODE_AS_TEXT[child.type.name];
        if (literal === undefined) return true;

        const names = child.marks.map((m) => m.type.name);
        const inserted = names.includes(MARK_INSERT);
        const deleted = names.includes(MARK_DELETE);
        if (inserted || deleted || names.includes(MARK_FORMAT)) touched = true;
        if (!inserted) before += literal;
        if (!deleted) after += literal;
        return true;
      });

      // Đổi định dạng thuần (trackFormat) không đổi chữ nào — backend làm việc
      // trên văn bản nên chưa biểu diễn được, bỏ qua thay vì gửi một đề xuất
      // rỗng rồi bị từ chối là `empty_edit`.
      if (touched && before !== after) {
        out.push({ paraId, kind: classify(before, after), before, after });
      }
      return false; // không đi sâu hơn paragraph
    });
    return out;
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({ getSelection: readSelection, collectSuggestions }),
    [readSelection, collectSuggestions]
  );

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host || !src) return;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Nạp động: SuperDoc là bundle lớn và chỉ chạy phía client
        const { SuperDoc } = await import("@harbour-enterprises/superdoc");

        // Qua `fetchBinary` để có Authorization — endpoint file của backend
        // kiểm quyền, không phải presigned URL trần
        const buffer = await fetchBinary(src);
        if (cancelled) return;

        const suggesting = mode === "suggesting";
        const file = new File([buffer], fileName, { type: DOCX_MIME });
        const instance = new SuperDoc({
          selector: host,
          document: file,
          documentMode: suggesting ? "suggesting" : "viewing",
          role: suggesting ? "suggester" : "viewer",
          // Thanh công cụ chỉ nhận SELECTOR DẠNG CHUỖI (`findElementBySelector`
          // gọi `selector.startsWith`) — truyền phần tử DOM vào là ném lỗi.
          ...(hideToolbar ? {} : { toolbar: `#${toolbarId}` }),
          // Không có cờ này thì `viewing` mode chặn cả việc bôi đen
          allowSelectionInViewMode: true,
          rulers: false,
          onReady: () => {
            if (cancelled) return;
            setLoading(false);
            onReady?.();
          },
        } as never);
        instanceRef.current = instance as SuperDocInstance;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Không mở được tài liệu");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        instanceRef.current?.destroy?.();
      } catch {
        /* instance đã bị dọn — bỏ qua */
      }
      instanceRef.current = null;
      host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, fileName, mode, hideToolbar, toolbarId]);

  /**
   * Theo dõi vùng chọn bằng sự kiện của TRÌNH DUYỆT, không phải của editor.
   *
   * SuperDoc không cho đăng ký `onSelectionUpdate` từ config ở chế độ xem, mà
   * `document.selectionchange` bắt đủ mọi đường đổi vùng chọn — chuột, bàn
   * phím, chạm — nên không phụ thuộc chi tiết nội bộ của thư viện.
   *
   * Hai chi tiết bắt buộc:
   *
   *  1. **Hoãn tới frame sau.** `selectionchange` bắn từ DOM; ProseMirror nghe
   *     rồi mới dispatch transaction cập nhật `state.selection`. Đọc ngay trong
   *     handler là có lúc lấy đúng vùng chọn CŨ.
   *  2. **Chỉ báo khi đổi ĐOẠN.** Handler này bắn theo từng nhịp di con trỏ;
   *     gọi `setState` ở trang cha mỗi nhịp là render lại cả workspace liên
   *     tục. Neo bình luận chỉ quan tâm đoạn nào, không quan tâm con trỏ ở ký
   *     tự thứ mấy.
   */
  useEffect(() => {
    if (!onSelectionChange) return;
    let frame = 0;
    let lastParaId: string | null = null;

    const handler = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = readSelection();
        const paraId = selection?.paraId ?? null;
        if (paraId === lastParaId) return;
        lastParaId = paraId;
        onSelectionChange(selection);
      });
    };

    document.addEventListener("selectionchange", handler);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", handler);
    };
  }, [onSelectionChange, readSelection]);

  return (
    <div className={cn("relative flex h-full min-h-0 flex-col bg-[#f3f3f3]", className)}>
      {!hideToolbar && (
        <div
          id={toolbarId}
          className="shrink-0 border-b bg-white [&:empty]:hidden"
        />
      )}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#f3f3f3]/80 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang mở tài liệu…
          </div>
        )}
        {error && (
          <div className="m-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Không mở được tài liệu</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          </div>
        )}
        <div ref={hostRef} className="superdoc-host min-h-full" />
      </div>
    </div>
  );
});
