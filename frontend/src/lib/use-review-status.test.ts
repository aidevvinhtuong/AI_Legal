/**
 * Theo dõi trạng thái ticket: SSE là chính, poll là đường lùi.
 *
 * ## Vì sao phải test
 *
 * Hook này thay thế vòng `setTimeout` 1,6 giây gọi `GET /reviews/{id}`. Nó đổi
 * một thứ đơn giản-mà-lãng-phí lấy một thứ hiệu quả-mà-có-nhánh, nên rủi ro
 * đổi chỗ: từ "tốn băng thông" sang "màn hình đứng im". Ba ca hỏng đều **không
 * ném lỗi**, tức không có gì đỏ lên nếu không test:
 *
 *  - SSE chết ngay từ đầu mà không lùi về poll → người dùng nhìn spinner mãi.
 *  - Ticket chạy xong mà không ai tải lại bản đầy đủ → kết quả AI không hiện ra.
 *  - `onSettled` gọi nhiều lần → mỗi lần là một `GET /reviews/{id}` đầy đủ,
 *    đúng thứ vừa bỏ công loại bỏ.
 *
 * Ca cuối là lý do có `stopped`/`settleOnce` trong hook — một cờ dễ bị xoá
 * trong lần refactor sau nếu không có gì canh.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewStatusEvent } from "@/lib/types";

/** Điều khiển tay client SSE để test không phụ thuộc mạng. */
const watchers: {
  id: string;
  onStatus?: (s: ReviewStatusEvent) => void;
  onDone?: () => void;
  onError?: (m: string) => void;
}[] = [];
const unwatch = vi.fn();

vi.mock("@/lib/review-service", () => ({
  watchReviewStatus: (id: string, handlers: Record<string, unknown>) => {
    watchers.push({ id, ...handlers });
    return unwatch;
  },
}));

const apiGet = vi.fn();
vi.mock("@/lib/api", () => ({ api: { get: (...a: unknown[]) => apiGet(...a) } }));

import { isInFlight, useReviewStatus } from "@/lib/use-review-status";

function statusEvent(patch: Partial<ReviewStatusEvent> = {}): ReviewStatusEvent {
  return {
    id: "rev_1",
    status: "processing",
    version: 1,
    queuePosition: null,
    confidence: 0,
    failureReason: null,
    allowedActions: [],
    updatedAt: "2026-08-27T00:00:00Z",
    ...patch,
  };
}

beforeEach(() => {
  watchers.length = 0;
  unwatch.mockClear();
  apiGet.mockReset();
});

describe("isInFlight", () => {
  it("đúng với các trạng thái tự đổi mà không cần người dùng", () => {
    expect(isInFlight("queued")).toBe(true);
    expect(isInFlight("processing")).toBe(true);
    expect(isInFlight("syncing_econtract")).toBe(true);
  });

  it("sai với trạng thái chờ người dùng — không mở kết nối vô ích", () => {
    expect(isInFlight("draft")).toBe(false);
    expect(isInFlight("reviewed")).toBe(false);
    expect(isInFlight("pending_legal")).toBe(false);
    expect(isInFlight(undefined)).toBe(false);
  });
});

describe("đường SSE", () => {
  it("không mở kết nối khi ticket đã ở trạng thái ổn định", () => {
    renderHook(() => useReviewStatus("rev_1", "reviewed", vi.fn()));
    expect(watchers).toHaveLength(0);
  });

  it("đẩy được trạng thái mới ra ngoài", async () => {
    const { result } = renderHook(() =>
      useReviewStatus("rev_1", "queued", vi.fn())
    );

    act(() => watchers[0].onStatus?.(statusEvent({ queuePosition: 3 })));

    expect(result.current.event?.queuePosition).toBe(3);
    expect(result.current.degraded).toBe(false);
  });

  it("báo xong ĐÚNG MỘT LẦN — mỗi lần thừa là một lượt tải cả review", async () => {
    const onSettled = vi.fn();
    renderHook(() => useReviewStatus("rev_1", "processing", onSettled));

    act(() => {
      watchers[0].onDone?.();
      watchers[0].onDone?.();
      watchers[0].onDone?.();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("đóng kết nối khi unmount", () => {
    const { unmount } = renderHook(() =>
      useReviewStatus("rev_1", "queued", vi.fn())
    );
    unmount();
    expect(unwatch).toHaveBeenCalled();
  });
});

describe("đường lùi khi SSE hỏng", () => {
  it("SSE lỗi → chuyển sang poll /status và báo degraded", async () => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue(statusEvent({ status: "processing" }));

    const { result } = renderHook(() =>
      useReviewStatus("rev_1", "queued", vi.fn())
    );

    act(() => watchers[0].onError?.("SSE 502"));
    expect(result.current.degraded).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Poll phải đánh vào endpoint NHẸ, không phải GET /reviews/{id} đầy đủ
    expect(apiGet).toHaveBeenCalledWith("/api/v1/reviews/rev_1/status");
    vi.useRealTimers();
  });

  it("poll thấy trạng thái ổn định thì báo xong và dừng hẳn", async () => {
    vi.useFakeTimers();
    const onSettled = vi.fn();
    apiGet.mockResolvedValue(statusEvent({ status: "reviewed" }));

    renderHook(() => useReviewStatus("rev_1", "processing", onSettled));
    act(() => watchers[0].onError?.("SSE đứt"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(onSettled).toHaveBeenCalledTimes(1);

    const callsAfterSettle = apiGet.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    // Đã xong thì không được poll thêm nhịp nào nữa
    expect(apiGet.mock.calls.length).toBe(callsAfterSettle);

    vi.useRealTimers();
  });

  it("một nhịp poll lỗi KHÔNG làm dừng vòng — mạng chập không được treo màn hình", async () => {
    vi.useFakeTimers();
    apiGet
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(statusEvent({ status: "processing" }));

    renderHook(() => useReviewStatus("rev_1", "queued", vi.fn()));
    act(() => watchers[0].onError?.("SSE đứt"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    // Nhịp 1 ném lỗi; nhịp 2 và 3 vẫn phải chạy. Dừng sau lỗi đầu tiên là
    // đúng loại hỏng mà test này canh.
    expect(apiGet.mock.calls.length).toBeGreaterThan(1);
    vi.useRealTimers();
  });
});
