/**
 * Thiết lập chung cho mọi test frontend.
 *
 * Hai việc, cả hai đều để test **không rò trạng thái sang nhau**:
 *
 *  1. Dọn DOM sau mỗi test — không thì component của test trước còn nằm đó và
 *     `getByRole` bắt nhầm.
 *  2. Dọn `localStorage` — phần lớn logic ở đây đọc token từ đó, nên một test
 *     quên dọn sẽ làm test sau xanh/đỏ tuỳ thứ tự chạy. Loại hỏng khó chịu nhất
 *     vì nó không tái hiện được khi chạy riêng từng file.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
