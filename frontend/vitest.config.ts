/**
 * Cấu hình test cho frontend.
 *
 * Trước vòng này frontend **không có hạ tầng test nào** — mọi logic phía client
 * chỉ được kiểm bằng `tsc --noEmit` (tức chỉ kiểu, không kiểm hành vi) và bằng
 * mắt. Những thứ đáng lo nhất lại nằm đúng ở đây: chính sách phiên đăng nhập,
 * ánh xạ quyền, và việc dịch lỗi cấu trúc `.docx` ra câu tiếng Việt.
 *
 * `jsdom` chứ không phải `node`: phần lớn logic cần `localStorage`, `document`
 * và sự kiện DOM. Chạy môi trường `node` rồi giả lập từng thứ một là tự dựng lại
 * một trình duyệt kém hơn.
 */

import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Phải khớp `paths` trong tsconfig.json — lệch là import gãy ở test mà
    // không gãy khi build, kiểu lỗi tốn nhiều thời gian nhất để tìm.
    alias: { "@": resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // `node_modules` của container là volume ẩn danh, đừng quét vào đó
    exclude: ["node_modules", ".next"],
  },
});
