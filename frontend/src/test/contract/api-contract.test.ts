/**
 * Mọi endpoint frontend gọi đều phải tồn tại ở backend.
 *
 * ## Vì sao cần bộ này
 *
 * Không có nó thì cách duy nhất phát hiện một endpoint gõ sai / bị đổi tên là
 * bấm đúng nút đó trên UI và nhận 404. Với những đường ít đi qua — huỷ
 * eContract, khôi phục cấu hình đã lưu trữ, đối soát trạng thái ký — có thể vài
 * tuần không ai bấm, và lỗi lộ ra đúng lúc pilot.
 *
 * Chuyện đã xảy ra thật theo chiều ngược lại: một lần rà thủ công kết luận nhầm
 * là backend thiếu 10 endpoint, chỉ vì chúng đăng ký bằng `router.add_api_route`
 * trong vòng lặp (`catalogs.py` `_ALIASES`, `config.py`) chứ không phải decorator
 * `@router.get`, nên grep không thấy. Đọc từ OpenAPI thì không có chỗ cho loại
 * nhầm đó.
 *
 * ## Ảnh chụp, không gọi mạng
 *
 * Test đọc `backend-routes.json` — ảnh chụp OpenAPI của backend — chứ không gọi
 * server đang chạy. Test phải chạy được trong CI khi chưa dựng backend, và phải
 * cho cùng một kết quả ở mọi máy.
 *
 * Cập nhật ảnh chụp khi backend thêm/đổi route:
 *
 *     make snapshot-routes
 *
 * Ảnh chụp **cũ đi** là rủi ro đã biết của cách này: nó chốt được FE không gọi
 * bừa, nhưng không tự biết backend vừa xoá một route. Đó là lý do lệnh cập nhật
 * nằm trong Makefile và nên chạy cùng lúc với migration.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import snapshot from "./backend-routes.json";

const SRC = resolve(__dirname, "../..");

/** Method + path FE gọi, đã chuẩn hoá tham số động về `{}`. */
type Call = { method: string; path: string; file: string; line: number };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * Quy `/reviews/${id}/submit` → `/reviews/{}/submit`.
 *
 * Cả hai phía đều quy về `{}` vì tên tham số hai bên vốn khác nhau — FE viết
 * `${id}`, backend khai `{review_id}` — mà chuyện đó không phải cái test này
 * quan tâm.
 */
function normalize(path: string): string {
  return path
    .replace(/\$\{[^}]*\}/g, "{}")
    .replace(/\{[^}]*\}/g, "{}")
    .split("?")[0]
    .replace(/\/+$/, "");
}

/**
 * FE có khớp một route backend không.
 *
 * So theo **từng đoạn** chứ không so chuỗi, vì hai phía tham số hoá khác chỗ
 * nhau ở hai ca có thật:
 *
 *  - Backend khai `/form-lists/{kind}/{slug}/usage`, FE gọi thẳng
 *    `/form-lists/contractNames/${id}/usage` — `kind` là hằng số ở FE. Một
 *    đoạn `{}` bên backend phải khớp được với đoạn chữ thường bên FE.
 *  - FE nối query bằng nội suy (`/config/audit${q}` với `q = "?a=b"` hoặc `""`),
 *    nên sau chuẩn hoá còn thừa một đoạn `{}` ở cuối. Thử cả bản có và không
 *    có đuôi đó.
 *
 * Chiều ngược lại KHÔNG nới: một đoạn chữ bên backend không khớp `{}` của FE,
 * vì như thế là FE đang gọi vào một đường mà nó không kiểm soát được hình dạng.
 */
function matchesBackend(call: { method: string; path: string }): boolean {
  const candidates = [call.path];
  // Đuôi `{}` do nội suy query sinh ra có thể dính liền (`/templates${q}`) hoặc
  // đứng riêng một đoạn (`/audit/${q}`) — bỏ cả hai dạng rồi thử lại.
  if (call.path.endsWith("{}")) {
    candidates.push(call.path.replace(/\/?\{\}$/, ""));
  }

  return candidates.some((candidate) => {
    const feParts = candidate.split("/");
    return BACKEND_PATTERNS.some((route) => {
      if (route.method !== call.method) return false;
      if (route.parts.length !== feParts.length) return false;
      return route.parts.every(
        (part, i) => part === "{}" || part === feParts[i]
      );
    });
  });
}

/** Quét lời gọi `api.get(...)` / `fetchBinary(...)` / `downloadFile(...)`. */
function collectCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");

    const push = (method: string, raw: string, index: number) => {
      if (!raw.startsWith("/api/")) return;
      calls.push({
        method,
        path: normalize(raw),
        file: file.slice(SRC.length + 1),
        line: text.slice(0, index).split("\n").length,
      });
    };

    for (const m of text.matchAll(
      /\bapi\.(get|post|put|patch|delete)\(\s*[`"']([^`"']*)[`"']/g
    )) {
      push(m[1].toUpperCase(), m[2], m.index ?? 0);
    }
    // Tải file nhị phân đi đường riêng (kèm Bearer token) nhưng vẫn là GET
    for (const m of text.matchAll(
      /\b(?:fetchBinary|downloadFile)\(\s*[`"']([^`"']*)[`"']/g
    )) {
      push("GET", m[1], m.index ?? 0);
    }
    // SSE mở bằng `fetch` trần — vẫn là một endpoint backend phải có
    for (const m of text.matchAll(/\bfetch\(\s*[`"'](\/api\/[^`"']*)[`"']/g)) {
      push("GET", m[1], m.index ?? 0);
    }
  }
  return calls;
}

const BACKEND_PATTERNS = (snapshot.routes as string[]).map((r) => {
  const [method, path] = r.split(" ");
  return { method, parts: normalize(path).split("/") };
});

const CALLS = collectCalls();

describe("hợp đồng FE ↔ BE", () => {
  it("quét được lời gọi API (bộ quét không hỏng im lặng)", () => {
    // Không có khẳng định này thì một regex hỏng làm mọi test dưới xanh giả:
    // không quét được gì đồng nghĩa không có gì để so.
    expect(CALLS.length).toBeGreaterThan(40);
  });

  it("mọi endpoint FE gọi đều có ở backend", () => {
    const missing = CALLS.filter((c) => !matchesBackend(c)).map(
      (c) => `${c.method} ${c.path}  ←  ${c.file}:${c.line}`
    );

    expect(missing).toEqual([]);
  });

  it("ảnh chụp backend không rỗng", () => {
    expect(BACKEND_PATTERNS.length).toBeGreaterThan(50);
  });
});

describe("đường dẫn FE tự viết", () => {
  it("luôn có tiền tố phiên bản /api/v1", () => {
    // `/api/...` không kèm `/v1` từng gây lỗi thật: Next rewrite chuyển tiếp
    // nguyên vẹn, nên thiếu `/v1` là 404 chứ không có ai vá hộ.
    const unversioned = CALLS.filter((c) => !c.path.startsWith("/api/v1/")).map(
      (c) => `${c.method} ${c.path}  ←  ${c.file}:${c.line}`
    );
    expect(unversioned).toEqual([]);
  });
});
