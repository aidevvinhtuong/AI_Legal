/**
 * Giả lập `fetch` và ghi lại mọi request — dùng cho test luồng nghiệp vụ.
 *
 * ## Vì sao không dùng `vi.fn()` trần
 *
 * Test luồng cần khẳng định ba thứ mà một `vi.fn()` trần không cho sẵn:
 *
 *  1. **Thứ tự** các lời gọi — luồng duyệt là một máy trạng thái, gọi
 *     `legal-decision` trước `submit` là sai kể cả khi cả hai đều được gọi.
 *  2. **Nội dung** gửi lên — `decision: "approve"` hay `"reject"` quyết định
 *     ticket đi tiếp hay quay về Purchasing.
 *  3. **Header** — `Authorization` và `If-Match`. Thiếu `If-Match` là hai tab
 *     ghi đè nhau im lặng (mục 5.6 CLAUDE.md), một lỗi không bao giờ ném
 *     exception nên không test thì không ai biết.
 *
 * Lớp giả lập đặt ở `fetch` chứ không ở `api.ts`: mọi thứ `api.ts` làm — gắn
 * Bearer token, dựng `If-Match`, dịch lỗi thành `ApiError`, xử lý 204 — đều là
 * hành vi cần được kiểm, không phải thứ nên bị giả lập đi.
 */

import { vi } from "vitest";

export type RecordedRequest = {
  method: string;
  /** Đường dẫn đã bỏ origin, giữ nguyên query. */
  path: string;
  headers: Record<string, string>;
  /** Body đã parse: object nếu JSON, `FormData` nếu multipart, `null` nếu rỗng. */
  body: unknown;
};

type Responder = (req: RecordedRequest) => {
  status?: number;
  json?: unknown;
} | void;

export class HttpRecorder {
  readonly requests: RecordedRequest[] = [];
  private responders: { match: RegExp; method?: string; respond: Responder }[] =
    [];

  /**
   * Khai báo phản hồi cho một endpoint. Khai sau đè khai trước khi cùng khớp,
   * để test viết được ca chung trước rồi ghi đè ca riêng.
   */
  on(method: string, match: RegExp, respond: Responder): this {
    this.responders.unshift({ match, method, respond });
    return this;
  }

  install(): void {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = (init?.method || "GET").toUpperCase();
      const headers = normalizeHeaders(init?.headers);

      const req: RecordedRequest = {
        method,
        path,
        headers,
        body: parseBody(init?.body),
      };
      this.requests.push(req);

      const hit = this.responders.find(
        (r) => (!r.method || r.method === method) && r.match.test(path)
      );
      const result = hit?.respond(req) ?? {};
      const status = result.status ?? 200;
      const payload = result.json ?? {};

      return new Response(status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  /** `["POST /api/v1/reviews", "POST /api/v1/reviews/r1/submit", …]` */
  trace(): string[] {
    return this.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);
  }

  find(method: string, pathIncludes: string): RecordedRequest | undefined {
    return this.requests.find(
      (r) => r.method === method && r.path.includes(pathIncludes)
    );
  }
}

function normalizeHeaders(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) {
    raw.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else if (Array.isArray(raw)) {
    for (const [k, v] of raw) out[k.toLowerCase()] = v;
  } else {
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return null;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
