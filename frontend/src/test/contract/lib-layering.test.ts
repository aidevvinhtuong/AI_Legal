/**
 * Ranh giới phân tầng trong `src/lib` — tương đương `import-linter` của backend.
 *
 * ## Vì sao phải chốt bằng test
 *
 * `src/lib` vừa được chia tầng từ một thư mục phẳng 25 mục. Không có gì canh thì
 * nó mục lại trong vài tuần: chỉ cần một lần "tiện tay" import `services/` vào
 * `domain/` là `domain/` hết test được bằng hàm thuần — phải giả lập mạng cho
 * mọi test luật nghiệp vụ. Không ai thấy điều đó lúc review một diff nhỏ.
 *
 * Đã có một vi phạm thật lúc chia tầng: `docx/content-controls.ts` import
 * `fetchBinary` từ `api.ts` cho hàm `analyzeDocxFromUrl()` — mà hàm đó không nơi
 * nào gọi. Một hàm chết kéo cả tầng `docx` dính vào tầng HTTP.
 *
 * Luật đầy đủ và lý do: `src/lib/README.md`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../..");
const LIB = join(SRC, "lib");

/** Tầng nào KHÔNG được import gì — theo `@/lib/...` và theo package ngoài. */
const RULES: {
  layer: string;
  forbidden: RegExp[];
  why: string;
}[] = [
  {
    layer: "domain",
    // `domain` là trung tâm: không mạng, không React, không tầng nào khác.
    forbidden: [/^@\/lib\/(?!domain\/)/, /^@\/lib\/api$/, /^react$/, /^next(\/|$)/],
    why:
      "domain/ phải là luật nghiệp vụ thuần — test được bằng hàm thuần, không cần " +
      "giả lập mạng hay render component.",
  },
  {
    layer: "docx",
    forbidden: [/^@\/lib\/(?!domain\/|docx\/)/, /^react$/, /^next(\/|$)/],
    why:
      "docx/ chỉ đọc và so sánh nội dung tệp. Cần tải tệp về thì nơi gọi tải, " +
      "rồi truyền ArrayBuffer vào — đừng để tầng này tự biết đường mạng.",
  },
  {
    layer: "auth",
    forbidden: [/^@\/lib\/services\//],
    why: "auth/ nằm dưới services/ — services/ dùng phiên, không phải ngược lại.",
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Mọi module mà `file` import. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("ranh giới phân tầng src/lib", () => {
  it.each(RULES)("$layer không import ra ngoài tầng của nó", ({ layer, forbidden, why }) => {
    const violations: string[] = [];

    for (const file of walk(join(LIB, layer))) {
      for (const spec of importsOf(file)) {
        if (forbidden.some((re) => re.test(spec))) {
          violations.push(`${relative(LIB, file)} → ${spec}`);
        }
      }
    }

    expect(violations, violations.length ? `${why}\n\nVi phạm:\n` : undefined).toEqual([]);
  });

  it("quét được file (bộ quét không hỏng im lặng)", () => {
    // Regex hỏng hoặc thư mục đổi tên sẽ làm mọi khẳng định trên xanh giả.
    const counted = RULES.reduce((n, r) => n + walk(join(LIB, r.layer)).length, 0);
    expect(counted).toBeGreaterThan(8);
  });
});

/**
 * Test phải nằm trong `src/test/`, không nằm cạnh file gốc.
 *
 * Đội này viết backend bằng Python với `backend/tests/`; để hai nửa dự án cùng
 * một thói quen thì frontend theo cùng quy ước. Không có gì canh thì lần thêm
 * test tới, người viết sẽ đặt cạnh file nguồn theo quán tính của hệ sinh thái
 * JS, và cây thư mục lại lẫn lộn như cũ.
 */
describe("vị trí file test", () => {
  it("không có .test.ts nào nằm ngoài src/test/", () => {
    const stray: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (full === join(SRC, "test")) continue;
          scan(full);
        } else if (/\.test\.tsx?$/.test(name)) {
          stray.push(relative(SRC, full));
        }
      }
    };
    scan(SRC);

    expect(
      stray,
      stray.length
        ? "Chuyển các file này sang src/test/ theo đúng đường dẫn soi gương " +
            "(src/lib/docx/x.ts → src/test/lib/docx/x.test.ts). Xem src/lib/README.md."
        : undefined
    ).toEqual([]);
  });

  it("mỗi test trong src/test/lib có module nguồn tương ứng", () => {
    const orphans: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.test\.ts$/.test(name)) {
          const src = full
            .replace(join(SRC, "test", "lib"), LIB)
            .replace(/\.test\.ts$/, ".ts");
          // `review-flow` kiểm luồng xuyên nhiều module, không soi gương 1-1
          if (basename(full) === "review-flow.test.ts") continue;
          if (!existsSync(src)) orphans.push(relative(SRC, full));
        }
      }
    };
    scan(join(SRC, "test", "lib"));

    expect(
      orphans,
      orphans.length ? "Test còn lại sau khi module nguồn bị xoá hoặc đổi tên." : undefined
    ).toEqual([]);
  });
});
