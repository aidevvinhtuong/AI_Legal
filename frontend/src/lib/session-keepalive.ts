/**
 * Giữ phiên theo **hoạt động thật của người dùng**, không theo "tab còn mở".
 *
 * ## Vì sao không chỉ hẹn giờ
 *
 * Bản đầu của tệp này gia hạn theo bộ hẹn giờ. Nó chữa được đúng triệu chứng
 * người dùng phàn nàn (đang làm thì bị đá ra), nhưng đẻ ra một vấn đề khác: máy
 * trạm bỏ quên mở tab vẫn được gia hạn suốt tới trần 8 giờ. Với hệ thống có dữ
 * liệu hợp đồng đặt trên bàn dùng chung thì đó là đánh đổi sai.
 *
 * Nên gia hạn chỉ xảy ra khi **có thao tác thật** kể từ lần gia hạn trước.
 *
 * ## Đồng hồ idle chính là hạn của token
 *
 * Không nuôi một đồng hồ "idle" riêng — nó sẽ trôi lệch so với hạn token và tạo
 * ra ca tệ nhất: hộp cảnh báo hiện ra **sau khi** token đã chết, người dùng bấm
 * "Tôi vẫn đang làm việc" và nhận lỗi.
 *
 * Thay vào đó mọi mốc đều tính từ `exp` của chính token:
 *
 *   có thao tác  →  gia hạn ở ~75% tuổi thọ, im lặng, người dùng không thấy gì
 *   không thao tác →  ở mốc `exp − 2 phút` hiện cảnh báo, token VẪN CÒN HIỆU LỰC
 *                     nên nút "Tôi vẫn đang làm việc" chắc chắn bấm được
 *
 * Hệ quả: thời gian idle = `ACCESS_TOKEN_MINUTES`. Một núm vặn, không phải hai
 * cái lệch nhau.
 *
 * ## Ranh giới tin cậy
 *
 * Chính sách idle nằm ở client — đúng chỗ của nó, vì nó là chuyện trải nghiệm.
 * Người dùng có thể giả vờ hoạt động, nhưng họ chính là người đang ngồi đó; mối
 * lo là máy bỏ quên, không phải chủ máy. Thứ **không** giả được là trần tuyệt
 * đối: backend từ chối gia hạn quá `REFRESH_TOKEN_HOURS` kể từ lần nhập mật
 * khẩu, bất kể client làm gì.
 */

import { api } from "@/lib/api";

/** Gia hạn khi token đã đi qua ngần này tuổi thọ (và CÓ thao tác). */
const REFRESH_AT = 0.75;

/** Hiện cảnh báo trước khi token hết hạn ngần này. */
const WARN_BEFORE_MS = 2 * 60_000;

/**
 * Không gia hạn dày hơn mức này. Người dùng gõ liên tục thì mỗi phím là một sự
 * kiện; thiếu chặn dưới là mỗi vài giây một request.
 */
const MIN_GAP_MS = 60_000;

/** Sự kiện coi là "người dùng đang làm việc". */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export type SessionEvent =
  /** Sắp hết phiên do không thao tác. `secondsLeft` để đếm ngược. */
  | { type: "idle-warning"; secondsLeft: number }
  /** Người dùng đã thao tác lại / đã bấm tiếp tục — đóng cảnh báo. */
  | { type: "resumed" }
  /** Phiên chết hẳn. `reason` quyết định câu thông báo. */
  | { type: "expired"; reason: "idle" | "absolute" };

type Listener = (event: SessionEvent) => void;

interface Claims {
  exp?: number;
  iat?: number;
}

/** Đọc claims mà KHÔNG xác thực chữ ký — chỉ để biết khi nào cần gia hạn. */
function readClaims(token: string): Claims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return JSON.parse(json) as Claims;
  } catch {
    return null;
  }
}

function currentToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trạng thái module — một bộ duy nhất cho cả ứng dụng
// ─────────────────────────────────────────────────────────────────────────────
let listeners: Listener[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastActivityAt = 0;
let lastRefreshAt = 0;
let warning = false;
let running = false;

function emit(event: SessionEvent) {
  for (const listener of listeners) listener(event);
}

export function onSessionEvent(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/**
 * Gia hạn ngay. Trả về `true` nếu thành công.
 *
 * `force` bỏ qua chặn tần suất — dùng cho nút "Tôi vẫn đang làm việc", nơi người
 * dùng vừa bấm nên phải phản hồi ngay chứ không im lặng bỏ qua.
 */
export async function refreshSession(force = false): Promise<boolean> {
  const token = currentToken();
  if (!token) return false;
  if (!force && Date.now() - lastRefreshAt < MIN_GAP_MS) return false;
  lastRefreshAt = Date.now();

  try {
    const session = await api.post("/api/v1/auth/refresh", undefined, {
      // KHÔNG để `fetchApi` tự đá về /login: gia hạn hỏng có thể chỉ là mất mạng
      // một nhịp. Phân biệt hai ca ở dưới bằng mã lỗi.
      skipAuthRedirect: true,
    });
    if (session?.token) {
      localStorage.setItem("token", session.token);
      if (session.sessionExpiresAt) {
        localStorage.setItem("sessionExpiresAt", session.sessionExpiresAt);
      }
      warning = false;
      emit({ type: "resumed" });
      return true;
    }
  } catch (e) {
    // 401 ở đây nghĩa là phiên đã chạm TRẦN TUYỆT ĐỐI — gia hạn thêm là vô ích,
    // và người dùng cần biết vì sao để khỏi bấm mãi.
    const status = (e as { status?: number })?.status;
    if (status === 401 || status === 403) {
      emit({ type: "expired", reason: "absolute" });
    }
  }
  return false;
}

function markActivity() {
  const previous = lastActivityAt;
  lastActivityAt = Date.now();

  // Đang hiện cảnh báo mà người dùng chạm vào màn hình: gia hạn ngay và đóng
  // cảnh báo. Bắt họ bấm đúng cái nút trong khi họ rõ ràng đang làm việc là
  // vô nghĩa.
  if (warning) {
    void refreshSession(true);
    return;
  }

  // Vừa từ trạng thái "không thao tác" trở lại: tính lại lịch ngay thay vì chờ
  // hẹn giờ cũ. Không làm thì lần gia hạn rơi vào mốc cảnh báo (`exp − 2 phút`)
  // — vẫn kịp, nhưng chỉ còn hai phút biên nếu mạng chậm hoặc request hỏng.
  //
  // Chặn dưới `MIN_GAP_MS` để mỗi phím gõ không kéo theo một lượt tính lịch.
  if (lastActivityAt - previous > MIN_GAP_MS) schedule();
}

/** Việc cần làm ở thời điểm hiện tại. */
export type NextAction =
  | { kind: "refresh" }
  | { kind: "warn"; secondsLeft: number }
  | { kind: "expire" }
  | { kind: "wait"; ms: number };

/**
 * Quyết định thuần — không đụng DOM, không đụng `localStorage`, không hẹn giờ.
 *
 * Tách ra vì đây là toàn bộ phần dễ sai của cơ chế giữ phiên. Là hàm thuần thì
 * diễn lại được cả dòng thời gian 30 phút trong vài mili-giây
 * (`session-keepalive.test.ts`); nằm lẫn trong `setTimeout` và sự kiện DOM thì
 * chỉ còn cách tin vào lập luận.
 */
export function nextAction(input: {
  expMs: number;
  iatMs: number;
  nowMs: number;
  lastActivityAt: number;
  lastRefreshAt: number;
}): NextAction {
  const { expMs, iatMs, nowMs, lastActivityAt, lastRefreshAt } = input;
  const refreshAtMs = iatMs + (expMs - iatMs) * REFRESH_AT;
  const warnAtMs = expMs - WARN_BEFORE_MS;

  // Có thao tác kể từ lần gia hạn trước ⇒ người dùng đang làm việc thật
  const active = lastActivityAt > lastRefreshAt;

  if (nowMs >= expMs) return { kind: "expire" };
  if (active) {
    return nowMs >= refreshAtMs
      ? { kind: "refresh" }
      : { kind: "wait", ms: refreshAtMs - nowMs };
  }
  return nowMs >= warnAtMs
    ? { kind: "warn", secondsLeft: Math.max(0, Math.round((expMs - nowMs) / 1000)) }
    : { kind: "wait", ms: warnAtMs - nowMs };
}

function schedule() {
  if (timer) clearTimeout(timer);
  const token = currentToken();
  if (!token) return;

  const claims = readClaims(token);
  if (!claims?.exp) return;

  const action = nextAction({
    expMs: claims.exp * 1000,
    iatMs: (claims.iat ?? claims.exp - 1800) * 1000,
    nowMs: Date.now(),
    lastActivityAt,
    lastRefreshAt,
  });

  switch (action.kind) {
    case "refresh":
      void refreshSession().then(schedule);
      return;
    case "expire":
      emit({ type: "expired", reason: "idle" });
      return;
    case "warn":
      if (!warning) {
        warning = true;
        emit({ type: "idle-warning", secondsLeft: action.secondsLeft });
      }
      // Nhịp một giây để hộp thoại đếm ngược đều
      timer = setTimeout(schedule, 1000);
      return;
    case "wait":
      timer = setTimeout(schedule, Math.max(1000, action.ms));
  }
}

/**
 * Bật cơ chế giữ phiên. Trả về hàm dừng.
 *
 * Gọi một lần ở khung layout — tự chống gọi trùng.
 */
export function startSessionKeepAlive(): () => void {
  if (typeof window === "undefined") return () => {};
  if (running) return () => {};
  running = true;

  // Coi lúc bật là một lần thao tác: người dùng vừa mở màn hình
  lastActivityAt = Date.now();
  lastRefreshAt = 0;
  warning = false;

  for (const name of ACTIVITY_EVENTS) {
    window.addEventListener(name, markActivity, { passive: true });
  }

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    // Quay lại tab CŨNG là thao tác. Và `setTimeout` không đáng tin qua chu kỳ
    // ngủ của máy, nên tính lại lịch từ đầu.
    markActivity();
    schedule();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);

  schedule();

  return () => {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const name of ACTIVITY_EVENTS) {
      window.removeEventListener(name, markActivity);
    }
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
