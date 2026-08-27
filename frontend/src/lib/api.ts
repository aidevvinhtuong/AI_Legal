/**
 * HTTP client cho FE → Backend.
 *
 * Browser mặc định gọi relative `/api/v1/...` (Next rewrite → API_REWRITE_URL).
 * Có thể ghi đè bằng NEXT_PUBLIC_API_URL (absolute) khi cần (SSR/test).
 *
 * Không còn chế độ mock: mọi dữ liệu nghiệp vụ đến từ backend.
 */

const RAW_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

/** Base URL: "" = same-origin (/api → rewrite). */
export const API_BASE_URL = RAW_BASE;

/**
 * Trình hiển thị `.docx`: `docx-preview` (mặc định) hoặc `superdoc`.
 *
 * Mặc định vẫn là `docx-preview` vì lớp diff của AI (`docx-inline-diff.ts`) gắn
 * vào DOM do nó sinh ra. Đổi sang SuperDoc là mất lớp diff đó cho tới khi port
 * xong — nên đây là cờ opt-in, không phải thay thế thẳng.
 */
export const DOCX_RENDERER =
  process.env.NEXT_PUBLIC_EDITOR === "superdoc" ? "superdoc" : "docx-preview";

interface FetchOptions extends Omit<RequestInit, "body" | "headers"> {
  data?: unknown;
  headers?: Record<string, string>;
  /** Không redirect /login khi 401 (vd. login endpoint). */
  skipAuthRedirect?: boolean;
  /**
   * `rowVersion` của bản ghi đang sửa → gửi thành header `If-Match`.
   *
   * Backend so với phiên bản hiện tại và trả 409 nếu người khác đã ghi trước.
   * Không gửi thì backend bỏ qua kiểm tra — tức là hai tab ghi đè nhau im lặng.
   */
  ifMatch?: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function resolveUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE_URL) return p;
  return `${API_BASE_URL}${p}`;
}

export async function fetchApi(path: string, options: FetchOptions = {}) {
  const url = resolveUrl(path);
  const {
    data,
    headers: customHeaders = {},
    skipAuthRedirect,
    ifMatch,
    ...restOptions
  } = options;

  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem("token") || "";
  }

  const isForm = typeof FormData !== "undefined" && data instanceof FormData;
  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(ifMatch !== undefined && { "If-Match": `"${ifMatch}"` }),
    ...customHeaders,
  };

  if (!isForm && data !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const config: RequestInit = {
    ...restOptions,
    headers,
  };

  if (data !== undefined) {
    if (isForm) {
      config.body = data as FormData;
    } else if (headers["Content-Type"] === "application/json") {
      config.body = JSON.stringify(data);
    } else {
      config.body = data as BodyInit;
    }
  }

  try {
    const response = await fetch(url, config);

    if (response.status === 401 && !skipAuthRedirect) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized - Please log in again");
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      throw new ApiError(
        response.status,
        String(
          errorData.message ||
            errorData.error ||
            errorData.detail ||
            "An error occurred"
        ),
        errorData
      );
    }

    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      500,
      error instanceof Error
        ? error.message
        : "Network error or server is unreachable"
    );
  }
}

/**
 * Tải file nhị phân (`.docx`) KÈM Authorization.
 *
 * Không dùng `fetch(url)` trần cho những link này: backend cố tình phục vụ file
 * qua endpoint kiểm quyền chứ không phải presigned URL trần, nên thiếu header
 * là 401. Đây đúng là lỗi đã gặp ở màn preview — `docx-embed` fetch thẳng và
 * nhận `401 /api/v1/reviews/{id}/files/reviewed`.
 */
export async function fetchBinary(path: string): Promise<ArrayBuffer> {
  const url = resolveUrl(path);
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401) {
    // Cùng hành vi với fetchApi: hết phiên thì về màn đăng nhập, không để
    // người dùng nhìn một khung trắng và tự đoán.
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new ApiError(401, "Phiên đăng nhập đã hết hạn");
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Không tải được file (${response.status})`);
  }
  return response.arrayBuffer();
}

/**
 * Tải file về máy QUA endpoint kiểm quyền.
 *
 * `<a href="/api/v1/...">` trần không gửi được header `Authorization`, mà backend
 * chỉ nhận Bearer token (không dùng cookie) — nên link kiểu đó luôn 401. Phải
 * fetch kèm token rồi mới dựng blob URL để trình duyệt lưu.
 */
export async function downloadFile(
  path: string,
  fileName: string
): Promise<void> {
  const buffer = await fetchBinary(path);
  const url = URL.createObjectURL(new Blob([buffer]));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Thu hồi ngay sau khi click là an toàn: trình duyệt đã giữ tham chiếu blob
    // cho lượt tải đang chạy. Không thu hồi thì blob nằm lại tới khi reload.
    URL.revokeObjectURL(url);
  }
}

export const api = {
  get: (url: string, options?: Omit<FetchOptions, "method">) =>
    fetchApi(url, { ...options, method: "GET" }),

  post: (url: string, data?: unknown, options?: Omit<FetchOptions, "method">) =>
    fetchApi(url, { ...options, method: "POST", data }),

  put: (url: string, data?: unknown, options?: Omit<FetchOptions, "method">) =>
    fetchApi(url, { ...options, method: "PUT", data }),

  delete: (url: string, options?: Omit<FetchOptions, "method">) =>
    fetchApi(url, { ...options, method: "DELETE" }),

  patch: (url: string, data?: unknown, options?: Omit<FetchOptions, "method">) =>
    fetchApi(url, { ...options, method: "PATCH", data }),
};
