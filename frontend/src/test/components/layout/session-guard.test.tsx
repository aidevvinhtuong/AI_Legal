/**
 * Hộp cảnh báo phiên — test component, để chứng minh hạ tầng test dùng được cho
 * React chứ không chỉ cho hàm thuần.
 *
 * Ba thứ ở đây là **quyết định nghiệp vụ**, không phải chi tiết trình bày:
 *
 *  1. Hộp phải nhắc **lưu thủ công**. Quy tắc A4c không tự lưu, nên mất phiên là
 *     mất phần chưa lưu — dòng chữ đó quan trọng hơn cả cái đồng hồ.
 *  2. Hết phiên do **quá trần** thì KHÔNG được hiện nút "Tôi vẫn đang làm việc".
 *     Bấm vào cũng vô ích, và để nút đó ở đấy là bảo người dùng làm việc vô nghĩa.
 *  3. Đếm ngược phải chạy, nếu không người ta không biết còn bao lâu để lưu.
 */

import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionGuard } from "@/components/layout/session-guard";

const listeners: ((e: unknown) => void)[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/services/reviews", () => ({
  clearSession: vi.fn(),
}));

vi.mock("@/lib/auth/session-keepalive", () => ({
  onSessionEvent: (fn: (e: unknown) => void) => {
    listeners.push(fn);
    return () => listeners.splice(listeners.indexOf(fn), 1);
  },
  refreshSession: vi.fn(async () => true),
}));

function emit(event: unknown) {
  act(() => {
    for (const fn of [...listeners]) fn(event);
  });
}

describe("im lặng khi phiên bình thường", () => {
  it("không hiện gì cho tới khi có sự kiện", () => {
    render(<SessionGuard />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("cảnh báo sắp hết phiên", () => {
  it("hiện đếm ngược và nhắc LƯU", () => {
    render(<SessionGuard />);
    emit({ type: "idle-warning", secondsLeft: 120 });

    expect(screen.getByText("Phiên sắp hết")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
    // Lời nhắc quan trọng nhất trong hộp thoại
    expect(screen.getByText(/không tự lưu/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tôi vẫn đang làm việc/i })).toBeInTheDocument();
  });

  it("đồng hồ chạy xuống", () => {
    vi.useFakeTimers();
    render(<SessionGuard />);
    emit({ type: "idle-warning", secondsLeft: 120 });

    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("1:55")).toBeInTheDocument();
  });

  it("thao tác lại thì hộp biến mất", () => {
    render(<SessionGuard />);
    emit({ type: "idle-warning", secondsLeft: 120 });
    expect(screen.getByText("Phiên sắp hết")).toBeInTheDocument();

    emit({ type: "resumed" });
    expect(screen.queryByText("Phiên sắp hết")).toBeNull();
  });
});

describe("phiên đã chết", () => {
  it("quá trần thì KHÔNG có nút gia hạn", () => {
    render(<SessionGuard />);
    emit({ type: "expired", reason: "absolute" });

    expect(screen.getByText("Phiên đăng nhập đã hết")).toBeInTheDocument();
    expect(screen.getByText(/thời hạn tối đa/i)).toBeInTheDocument();
    // Để nút này ở đây là bảo người dùng bấm một thứ chắc chắn thất bại
    expect(screen.queryByRole("button", { name: /Tôi vẫn đang làm việc/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Đăng nhập lại/i })).toBeInTheDocument();
  });

  it("hết do không thao tác thì nói đúng lý do đó", () => {
    render(<SessionGuard />);
    emit({ type: "expired", reason: "idle" });
    expect(screen.getByText(/không có thao tác nào/i)).toBeInTheDocument();
  });

  it("vẫn nhắc chuyện chưa lưu", () => {
    render(<SessionGuard />);
    emit({ type: "expired", reason: "idle" });
    expect(screen.getByText(/không tự lưu/i)).toBeInTheDocument();
  });
});
