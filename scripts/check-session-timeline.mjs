/**
 * Kiểm dòng thời gian của cơ chế giữ phiên (`lib/session-keepalive.ts`).
 *
 * Frontend chưa có hạ tầng test (không vitest, không jest), nên đây là cách duy
 * nhất hiện tại để **chứng minh** thay vì lập luận. Chạy:
 *
 *     node scripts/check-session-timeline.mjs
 *
 * Nó biên dịch đúng một tệp bằng `tsc` rồi diễn lại các dòng thời gian đáng ngờ.
 * Thấy đỏ ở đây nghĩa là chính sách phiên đã đổi hành vi — đọc kỹ trước khi sửa
 * cho xanh.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MIN = 60_000;

// TypeScript chỉ có trong container `frontend` (host mount đè `node_modules`),
// nên biên dịch ở đó. Xuất vào /app — vốn là bind mount của ./frontend — để host
// nạp được, rồi dọn ngay. Cùng cách `check-editor-text-parity.sh` đang làm.
const OUT_IN_CONTAINER = "/app/.session-check";
const OUT_ON_HOST = "frontend/.session-check";

function cleanup() {
  rmSync(OUT_ON_HOST, { recursive: true, force: true });
}
process.on("exit", cleanup);

let nextAction;
try {
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "frontend", "npx", "tsc",
     "src/lib/session-keepalive.ts", "--outDir", OUT_IN_CONTAINER,
     "--module", "esnext", "--target", "es2022",
     "--moduleResolution", "bundler", "--skipLibCheck"],
    { stdio: "pipe" }
  );
} catch (e) {
  // `tsc` báo lỗi vì tệp import `@/lib/api` — không sao, nó vẫn sinh JS.
  if (process.env.DEBUG) {
    console.error(String(e.stdout || ""), String(e.stderr || ""));
  }
}

const emitted = join(OUT_ON_HOST, "session-keepalive.js");
if (!existsSync(emitted)) {
  console.error(
    "Không biên dịch được. Cần container `frontend` đang chạy:\n" +
      "  docker compose up -d frontend"
  );
  process.exit(2);
}
// Node không giải được alias `@/lib/api` của Next. `nextAction` là hàm THUẦN,
// không đụng tới module đó — nhưng câu `import` vẫn chạy lúc nạp, nên thay bằng
// stub. Chỉ đụng dòng import; phần logic được kiểm giữ nguyên từng ký tự.
const compiled = readFileSync(emitted, "utf8").replace(
  /^import\s*\{[^}]*\}\s*from\s*["']@\/lib\/api["'];?$/m,
  "const api = {}; const USE_MOCK = false;"
);
writeFileSync(emitted, compiled);

try {
  ({ nextAction } = await import(pathToFileURL(emitted).href));
} catch (e) {
  console.error("Không nạp được bản biên dịch:", e.message);
  process.exit(2);
}

// ── Dòng thời gian: token cấp lúc T0, sống 30 phút ──────────────────────────
const T0 = 1_700_000_000_000;
const LIFE = 30 * MIN;
const base = { iatMs: T0, expMs: T0 + LIFE };

let failures = 0;
function check(label, actual, expected) {
  const ok = actual.kind === expected;
  if (!ok) failures += 1;
  const mark = ok ? "✓" : "✗";
  const extra = actual.kind === "wait" ? ` (còn ${Math.round(actual.ms / MIN)} phút)` : "";
  console.log(`  ${mark} ${label.padEnd(52)} → ${actual.kind}${extra}`);
  if (!ok) console.log(`      mong đợi: ${expected}`);
}

console.log("\nNGƯỜI DÙNG ĐANG LÀM VIỆC (có thao tác sau lần gia hạn trước)");
const active = { lastActivityAt: T0 + 1, lastRefreshAt: T0 };
// Mốc gia hạn = 75% của 30 phút = phút 22,5. Ranh giới này đáng kiểm cả hai
// phía: bản đầu của script kỳ vọng phút 22 đã gia hạn — sai nửa phút, và đó
// đúng là loại nhầm khiến người ta sửa code cho vừa test.
check("phút 5    — còn xa mốc gia hạn", nextAction({ ...base, ...active, nowMs: T0 + 5 * MIN }), "wait");
check("phút 22   — CHƯA tới 75% (22,5)", nextAction({ ...base, ...active, nowMs: T0 + 22 * MIN }), "wait");
check("phút 22,5 — đúng mốc 75%", nextAction({ ...base, ...active, nowMs: T0 + 22.5 * MIN }), "refresh");
check("phút 29   — sát hạn, vẫn gia hạn", nextAction({ ...base, ...active, nowMs: T0 + 29 * MIN }), "refresh");

console.log("\nNGƯỜI DÙNG KHÔNG THAO TÁC (tab mở nhưng không ai đụng)");
const idle = { lastActivityAt: T0 - 1, lastRefreshAt: T0 };
check("phút 22 — KHÔNG tự gia hạn", nextAction({ ...base, ...idle, nowMs: T0 + 22 * MIN }), "wait");
check("phút 27 — chưa tới mốc cảnh báo", nextAction({ ...base, ...idle, nowMs: T0 + 27 * MIN }), "wait");
check("phút 28 — cảnh báo, token CÒN hạn", nextAction({ ...base, ...idle, nowMs: T0 + 28 * MIN }), "warn");
check("phút 30 — hết phiên", nextAction({ ...base, ...idle, nowMs: T0 + 30 * MIN }), "expire");

console.log("\nĐIỂM MẤU CHỐT: cảnh báo phải hiện KHI TOKEN CÒN SỐNG");
const warn = nextAction({ ...base, ...idle, nowMs: T0 + 28 * MIN });
const stillValid = T0 + 28 * MIN < base.expMs;
const ok = warn.kind === "warn" && stillValid && warn.secondsLeft === 120;
if (!ok) failures += 1;
console.log(
  `  ${ok ? "✓" : "✗"} còn ${warn.secondsLeft}s để bấm "Tôi vẫn đang làm việc", token chưa hết hạn`
);
console.log(
  "      Cảnh báo hiện SAU khi token chết là ca tệ nhất: người dùng bấm nút và nhận lỗi."
);

console.log("\nTHAO TÁC LẠI TRONG LÚC ĐANG CẢNH BÁO");
check(
  "phút 28, vừa chạm màn hình → gia hạn ngay",
  nextAction({ ...base, lastActivityAt: T0 + 28 * MIN, lastRefreshAt: T0, nowMs: T0 + 28 * MIN }),
  "refresh"
);

console.log(
  failures === 0
    ? "\n✓ Dòng thời gian đúng như thiết kế.\n"
    : `\n✗ ${failures} mốc sai — chính sách phiên đã đổi hành vi.\n`
);
process.exit(failures === 0 ? 0 : 1);
