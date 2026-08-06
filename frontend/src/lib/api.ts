const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

interface FetchOptions extends Omit<RequestInit, "body" | "headers"> {
  data?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchApi(fullUrl: string, options: FetchOptions = {}) {
  const url = fullUrl.startsWith("http") ? fullUrl : `${API_BASE_URL}${fullUrl}`;
  const { data, headers: customHeaders = {}, ...restOptions } = options;

  let token = "";
  if (typeof window !== "undefined") {
    token = localStorage.getItem("token") || "";
  }

  const headers: Record<string, string> = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...customHeaders,
  };

  if (!headers["Content-Type"] && data && !(data instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const config: RequestInit = {
    ...restOptions,
    headers,
  };

  if (data) {
    if (data instanceof FormData) {
      config.body = data;
    } else if (headers["Content-Type"] === "application/json") {
      config.body = JSON.stringify(data);
    } else {
      config.body = data as BodyInit;
    }
  }

  try {
    const response = await fetch(url, config);

    if (response.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
      throw new ApiError(401, "Unauthorized - Please log in again");
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        errorData.message || errorData.detail || "An error occurred"
      );
    }

    if (response.status === 204) return null;

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Network error or server is unreachable");
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
