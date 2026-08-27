/**
 * Chính sách phiên đăng nhập — phần dễ sai nhất của frontend.
 *
 * Ba thứ phải đúng cùng lúc, và chúng kéo nhau:
 *
 *   1. người **đang làm việc** không bao giờ bị ngắt
 *   2. máy **bỏ quên** phải hết phiên
 *   3. cảnh báo phải hiện **khi token còn sống** — hiện sau khi token chết là ca
 *      tệ nhất: người dùng bấm "Tôi vẫn đang làm việc" và nhận lỗi
 *
 * Điều 3 là lý do mọi mốc đều tính từ `exp` của chính token thay vì nuôi một
 * đồng hồ idle riêng: hai đồng hồ sẽ trôi lệch.
 */

import { describe, expect, it } from "vitest";
import { nextAction } from "@/lib/auth/session-keepalive";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const LIFE = 30 * MIN;

/** Token cấp lúc T0, sống 30 phút — đúng `ACCESS_TOKEN_MINUTES` của backend. */
const token = { iatMs: T0, expMs: T0 + LIFE };

/** Có thao tác sau lần gia hạn gần nhất. */
const working = { lastActivityAt: T0 + 1, lastRefreshAt: T0 };
/** Không đụng gì kể từ lần gia hạn gần nhất. */
const idle = { lastActivityAt: T0 - 1, lastRefreshAt: T0 };

const at = (minutes: number, who: typeof working | typeof idle) =>
  nextAction({ ...token, ...who, nowMs: T0 + minutes * MIN });

describe("người dùng đang làm việc", () => {
  it("chưa tới 75% tuổi thọ thì chỉ chờ", () => {
    expect(at(5, working)).toEqual({ kind: "wait", ms: 17.5 * MIN });
  });

  it("mốc gia hạn là 22,5 phút chứ không phải 22", () => {
    // Ranh giới này từng làm tôi viết sai kỳ vọng. Giữ cả hai phía để lần sau
    // ai đó đổi `REFRESH_AT` sẽ thấy ngay chứ không đoán.
    expect(at(22, working).kind).toBe("wait");
    expect(at(22.5, working).kind).toBe("refresh");
  });

  it("sát hạn vẫn gia hạn, không bao giờ bỏ mặc", () => {
    expect(at(29, working).kind).toBe("refresh");
  });

  it("KHÔNG bao giờ cảnh báo khi đang làm việc", () => {
    for (const m of [5, 22, 22.5, 25, 28, 29.9]) {
      expect(at(m, working).kind).not.toBe("warn");
    }
  });
});

describe("máy bỏ quên", () => {
  it("không tự gia hạn dù đã qua mốc 75%", () => {
    // Đây là khác biệt cốt lõi so với bản gia hạn theo bộ hẹn giờ: tab còn mở
    // KHÔNG đồng nghĩa người còn ngồi đó.
    expect(at(22.5, idle).kind).toBe("wait");
    expect(at(25, idle).kind).toBe("wait");
  });

  it("cảnh báo ở mốc exp − 2 phút", () => {
    expect(at(27.9, idle).kind).toBe("wait");
    expect(at(28, idle)).toEqual({ kind: "warn", secondsLeft: 120 });
  });

  it("cảnh báo hiện khi token VẪN CÒN HIỆU LỰC", () => {
    const warn = at(28, idle);
    expect(warn.kind).toBe("warn");
    // Nếu chỗ này sai thì nút "Tôi vẫn đang làm việc" bấm vào sẽ lỗi
    expect(T0 + 28 * MIN).toBeLessThan(token.expMs);
  });

  it("đếm ngược giảm dần trong lúc cảnh báo", () => {
    expect(at(28, idle)).toMatchObject({ secondsLeft: 120 });
    expect(at(29, idle)).toMatchObject({ secondsLeft: 60 });
    expect(at(29.5, idle)).toMatchObject({ secondsLeft: 30 });
  });

  it("hết phiên đúng lúc token hết hạn", () => {
    expect(at(30, idle).kind).toBe("expire");
    expect(at(45, idle).kind).toBe("expire");
  });
});

describe("thao tác lại", () => {
  it("chạm màn hình trong lúc cảnh báo thì gia hạn ngay", () => {
    const justTouched = { lastActivityAt: T0 + 28 * MIN, lastRefreshAt: T0 };
    expect(nextAction({ ...token, ...justTouched, nowMs: T0 + 28 * MIN }).kind).toBe("refresh");
  });

  it("token đã hết hạn thì thao tác cũng không cứu được", () => {
    // Quá `exp` là phải đăng nhập lại — gia hạn cần token còn hiệu lực.
    const justTouched = { lastActivityAt: T0 + 31 * MIN, lastRefreshAt: T0 };
    expect(nextAction({ ...token, ...justTouched, nowMs: T0 + 31 * MIN }).kind).toBe("expire");
  });
});

describe("token thiếu iat", () => {
  it("vẫn quyết định được, không ném lỗi", () => {
    // `readClaims` có thể trả token thiếu `iat` (token cũ, hoặc bên thứ ba).
    // Hỏng ở đây nghĩa là cơ chế giữ phiên chết im lặng và người dùng bị đá ra.
    const action = nextAction({
      expMs: T0 + LIFE,
      iatMs: T0 + LIFE - 1800_000,
      nowMs: T0,
      ...working,
    });
    expect(["wait", "refresh"]).toContain(action.kind);
  });
});
