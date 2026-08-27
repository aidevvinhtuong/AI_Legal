/**
 * Theo dõi trạng thái một ticket trong lúc AI chạy.
 *
 * ## Thay cho cái gì
 *
 * Trước: màn chi tiết hợp đồng `setTimeout` 1,6 giây một lần gọi
 * `GET /reviews/{id}` — endpoint trả **toàn bộ** review kèm `fields`,
 * `proposals`, `messages`, `versionHistory`. Một job AI 10 phút (NFR-P2) là
 * ~375 lần tải lại cả tài liệu để đọc đúng một chuỗi `status`.
 *
 * Trong khi đó backend đã có sẵn hai thứ tốt hơn và **không ai dùng**:
 * `GET /reviews/{id}/events` (SSE) và `GET /reviews/{id}/status` (bản nhẹ, kèm
 * `queuePosition`). Client SSE cũng đã viết xong trong `review-service` nhưng
 * chưa có nơi gọi. Hook này nối ba mảnh đó lại.
 *
 * ## Vì sao vẫn giữ đường poll
 *
 * SSE đi qua proxy, và proxy có thể buffer hoặc cắt kết nối im lặng. Backend đã
 * chống bằng heartbeat + `X-Accel-Buffering: no`, nhưng đó là giả định về cấu
 * hình hạ tầng mà frontend không kiểm soát được. Nên: SSE là đường chính, hỏng
 * thì lùi về poll `/status` — vẫn nhẹ hơn nhiều so với tải cả review, và người
 * dùng không thấy màn hình đứng im.
 *
 * Hook **không** tự tải lại review. Nó báo `onSettled` khi ticket sang trạng
 * thái ổn định, và nơi gọi quyết định lấy dữ liệu đầy đủ đúng một lần.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { watchReviewStatus } from "@/lib/services/reviews";
import type { ReviewStatus, ReviewStatusEvent } from "@/lib/domain/types";

/** Trạng thái còn tự đổi mà không cần người dùng làm gì. */
const IN_FLIGHT: ReviewStatus[] = ["queued", "processing", "syncing_econtract"];

export function isInFlight(status: ReviewStatus | undefined): boolean {
  return !!status && IN_FLIGHT.includes(status);
}

/** Nhịp lùi khi SSE không dùng được. Thưa hơn 1,6s cũ vì payload đã nhẹ hơn. */
const FALLBACK_POLL_MS = 3000;

export function useReviewStatus(
  reviewId: string | undefined,
  currentStatus: ReviewStatus | undefined,
  /** Gọi đúng một lần khi ticket chạy xong — nơi gọi tự tải lại bản đầy đủ. */
  onSettled: () => void
): { event: ReviewStatusEvent | null; degraded: boolean } {
  const [event, setEvent] = useState<ReviewStatusEvent | null>(null);
  const [degraded, setDegraded] = useState(false);

  // Giữ trong ref: `onSettled` thường là closure mới mỗi lần render, đưa vào
  // deps sẽ dựng lại kết nối SSE liên tục.
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const active = isInFlight(currentStatus);

  useEffect(() => {
    if (!reviewId || !active) return;

    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const settleOnce = () => {
      if (stopped) return;
      stopped = true;
      settledRef.current();
    };

    const startFallbackPoll = () => {
      if (stopped || pollTimer) return;
      setDegraded(true);
      pollTimer = setInterval(async () => {
        try {
          const next = (await api.get(
            `/api/v1/reviews/${reviewId}/status`
          )) as ReviewStatusEvent;
          setEvent(next);
          if (!isInFlight(next.status)) {
            clearInterval(pollTimer);
            settleOnce();
          }
        } catch {
          // Mạng chập chờn — giữ nhịp, lần sau thử lại. Dừng hẳn ở đây thì màn
          // hình đứng im vĩnh viễn sau một lần lỗi thoáng qua.
        }
      }, FALLBACK_POLL_MS);
    };

    const unwatch = watchReviewStatus(reviewId, {
      onStatus: (next) => {
        setEvent(next);
        setDegraded(false);
      },
      onDone: settleOnce,
      onError: startFallbackPoll,
    });

    return () => {
      stopped = true;
      unwatch();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [reviewId, active]);

  return { event, degraded };
}
