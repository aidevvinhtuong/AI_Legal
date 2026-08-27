/**
 * Phiên đăng nhập — đọc/ghi/xoá.
 *
 * ## Vì sao tách khỏi `review-service`
 *
 * Ba hàm này trước nằm trong `review-service.ts`. Hệ quả: mọi module cần biết
 * "ai đang đăng nhập" phải import cả tầng review — và `config-service` làm đúng
 * thế, tạo thành **phụ thuộc vòng** `config-service → review-service →
 * (dynamic import) config-service`. Cái `await import(...)` trong
 * `completeMarkersAndPushEcontract` không phải để tách bundle; nó là băng dán
 * che vòng đó khỏi vỡ lúc nạp module.
 *
 * Phiên là mối quan tâm của **auth**, không phải của nghiệp vụ review. Đặt
 * riêng ở đây thì `config-service` chỉ phụ thuộc vào thứ nó thật sự cần, và
 * vòng biến mất.
 *
 * ## Ranh giới với `api.ts`
 *
 * `api.ts` **đọc** `localStorage.token` trực tiếp và tự xoá phiên khi gặp 401.
 * File này không gọi `api.ts` và `api.ts` không import file này — cố ý, để
 * không dựng lại một vòng khác ở tầng thấp hơn. Khoá `localStorage` là hợp
 * đồng chung giữa hai bên; đổi tên khoá phải sửa cả hai chỗ.
 */

import { defaultPermissionsForRole } from "@/lib/permissions";
import type { UserSession } from "@/lib/types";

const TOKEN_KEY = "token";
const USER_KEY = "user";
const SESSION_EXPIRES_KEY = "sessionExpiresAt";

export function getSession(): UserSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UserSession;
    // Session cũ chưa có permissions → suy từ role
    if (!parsed.permissions?.length && parsed.role) {
      parsed.permissions = defaultPermissionsForRole(parsed.role);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(user: UserSession) {
  localStorage.setItem(TOKEN_KEY, user.token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  // Trần TUYỆT ĐỐI của phiên — khác hạn của token. Token được gia hạn liên tục
  // trong lúc còn làm việc; mốc này thì không đẩy được, vì nó tính từ lần nhập
  // mật khẩu gốc.
  if (user.sessionExpiresAt) {
    localStorage.setItem(SESSION_EXPIRES_KEY, user.sessionExpiresAt);
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
