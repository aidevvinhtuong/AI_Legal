/**
 * HTTP client cho FE → Backend.
 *
 * Browser mặc định gọi relative `/api/...` (Next rewrite → API_REWRITE_URL).
 * Có thể ghi đè bằng NEXT_PUBLIC_API_URL (absolute) khi cần (SSR/test).
 *
 * Mock dữ liệu nghiệp vụ: NEXT_PUBLIC_USE_MOCK=true (localStorage).
 * API server-only (eContract live, prompts file) vẫn gọi BE trừ khi mock eContract.
 */

const RAW_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

/** Base URL: "" = same-origin (/api → rewrite). */
export const API_BASE_URL = RAW_BASE;

export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

/**
 * Khi USE_MOCK=true: mặc định giả lập đẩy eContract (không cần BE).
 * Bật true để vẫn gọi BE push thật trong lúc demo mock data.
 */
export const ECONTRACT_LIVE =
  process.env.NEXT_PUBLIC_ECONTRACT_LIVE === "true";

interface FetchOptions extends Omit<RequestInit, "body" | "headers"> {
  data?: unknown;
  headers?: Record<string, string>;
  /** Không redirect /login khi 401 (vd. login endpoint). */
  skipAuthRedirect?: boolean;
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
    ...restOptions
  } = options;

  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem("token") || "";
  }

  const isForm = typeof FormData !== "undefined" && data instanceof FormData;
  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
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
