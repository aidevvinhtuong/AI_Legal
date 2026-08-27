"use client";

/**
 * Hộp cảnh báo phiên sắp hết — mảnh nhìn thấy được của cơ chế giữ phiên.
 *
 * ## Vì sao cần cảnh báo chứ không im lặng hết phiên
 *
 * Quy tắc **A4c** của dự án bắt lưu thủ công cho mọi chỉnh sửa. Hết phiên im
 * lặng nghĩa là màn hình nhảy về `/login` và **mất trắng phần chưa lưu** — người
 * dùng không kịp làm gì. Hai phút báo trước là đủ để bấm Lưu.
 *
 * ## Hai lý do hết phiên, hai câu nói khác nhau
 *
 *   `idle`     — không thao tác. Còn cứu được: bấm một cái là gia hạn.
 *   `absolute` — đã quá trần kể từ lần nhập mật khẩu. KHÔNG cứu được, phải đăng
 *                nhập lại. Nói thẳng thay vì để họ bấm mãi một cái nút vô dụng.
 *
 * ## Chạm vào màn hình cũng tính là "tôi vẫn ở đây"
 *
 * `session-keepalive` gia hạn ngay khi có thao tác trong lúc cảnh báo đang hiện.
 * Bắt người dùng bấm đúng một cái nút trong khi họ rõ ràng đang làm việc là thứ
 * làm người ta ghét các phần mềm nội bộ.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearSession } from "@/lib/session";
import {
  onSessionEvent,
  refreshSession,
  type SessionEvent,
} from "@/lib/session-keepalive";

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SessionGuard() {
  const router = useRouter();
  const [state, setState] = useState<SessionEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      onSessionEvent((event) => {
        if (event.type === "resumed") {
          setState(null);
          return;
        }
        setState(event);
      }),
    []
  );

  // Đếm ngược cục bộ: giữ số nhảy đều mỗi giây kể cả khi bộ hẹn giờ ở
  // `session-keepalive` bị trình duyệt bóp lại.
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (state?.type !== "idle-warning") return;
    setLeft(state.secondsLeft);
    const id = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [state]);

  const signOut = () => {
    clearSession();
    router.push("/login");
  };

  if (!state || state.type === "resumed") return null;

  const expiredAbsolute = state.type === "expired" && state.reason === "absolute";
  const expiredIdle = state.type === "expired" && state.reason === "idle";
  const expired = expiredAbsolute || expiredIdle;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {expired ? "Phiên đăng nhập đã hết" : "Phiên sắp hết"}
          </DialogTitle>
          <DialogDescription>
            {expiredAbsolute
              ? "Phiên đã đạt thời hạn tối đa kể từ lần đăng nhập. Cần đăng nhập lại để tiếp tục."
              : expiredIdle
                ? "Phiên đã hết do không có thao tác nào. Cần đăng nhập lại để tiếp tục."
                : "Bạn chưa thao tác một lúc rồi. Phiên sẽ hết sau:"}
          </DialogDescription>
        </DialogHeader>

        {!expired && (
          <div className="py-2 text-center">
            <span className="font-mono text-3xl font-semibold tabular-nums">
              {mmss(left)}
            </span>
          </div>
        )}

        {/* A4c: mọi chỉnh sửa phải lưu thủ công, nên đây là lời nhắc quan trọng
            nhất trong hộp thoại — quan trọng hơn cả cái đồng hồ. */}
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {expired
            ? "Nếu đang có chỉnh sửa chưa lưu, chúng sẽ không được giữ lại. Hệ thống lưu thủ công, không tự lưu."
            : "Nếu đang có chỉnh sửa chưa lưu, hãy bấm Lưu trước — hệ thống không tự lưu."}
        </p>

        <DialogFooter>
          {expired ? (
            <Button onClick={signOut}>Đăng nhập lại</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={signOut} disabled={busy}>
                Đăng xuất
              </Button>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await refreshSession(true);
                  setBusy(false);
                  if (ok) setState(null);
                }}
              >
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Tôi vẫn đang làm việc
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
