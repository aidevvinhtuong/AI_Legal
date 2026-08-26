/**
 * Dịch lỗi cấu trúc `.docx` ra câu người dùng đọc được.
 *
 * Đây là màn hình duy nhất người dùng gặp khi tệp upload lại (PT3) bị chặn theo
 * ràng buộc **C-4**. Nếu câu chữ ở đây rỗng hoặc chung chung thì họ chỉ biết
 * "sai cấu trúc" mà không biết sai ở đâu, và không có cách nào tự sửa —
 * **không có cơ chế override**, nên thông báo là lối thoát duy nhất.
 *
 * Bản trước khai `type` chỉ ba giá trị, còn backend phát ra bảy. Bốn loại còn
 * lại rơi vào nhánh `default` và **mất `diffPreview`** — đúng chỗ chứa lời khuyên
 * hành động ("Nhiều khả năng Restrict Editing đã bị gỡ, hãy tải lại template
 * gốc"). Người dùng nhận đúng một cái tên vị trí trống rỗng.
 */

import { describe, expect, it } from "vitest";
import { formatIssueMessage, type FieldStructureIssue } from "@/lib/reupload-validation";

/** Bảy loại backend thật sự phát ra — khớp `structural_binding.py`. */
const BACKEND_TYPES = [
  "missing_field",
  "unexpected_new_field",
  "locked_region_modified",
  "mechanism_mismatch",
  "protection_removed",
  "count_mismatch",
  "region_kind_changed",
] as const;

describe("mọi loại lỗi backend phát ra đều dịch được", () => {
  it.each(BACKEND_TYPES)("%s có nhãn tiếng Việt riêng", (type) => {
    const message = formatIssueMessage({ type, location: "Điều 12" });
    expect(message).toContain("Điều 12");
    // Không được rơi về nhãn chung — mỗi loại phải nói đúng chuyện đã xảy ra
    expect(message).not.toBe("Điều 12");
    expect(message.length).toBeGreaterThan("Điều 12".length);
  });

  it("bảy nhãn khác nhau, không trùng", () => {
    const labels = BACKEND_TYPES.map((type) =>
      formatIssueMessage({ type, location: "X" })
    );
    expect(new Set(labels).size).toBe(BACKEND_TYPES.length);
  });
});

describe("diffPreview không bao giờ bị bỏ rơi", () => {
  it.each(BACKEND_TYPES)("%s vẫn kèm diffPreview", (type) => {
    // Chốt đúng cái đã hỏng: bốn loại từng rơi vào `default` và mất phần này.
    const message = formatIssueMessage({
      type,
      location: "Điều 12",
      diffPreview: "Trước: “A” → Sau: “B”",
    });
    expect(message).toContain("Trước: “A” → Sau: “B”");
  });

  it("mechanism_mismatch giữ được lời khuyên hành động", () => {
    const message = formatIssueMessage({
      type: "mechanism_mismatch",
      location: "File dùng không có vùng mở nào, template dùng permission_range",
      diffPreview: "Nhiều khả năng Restrict Editing đã bị gỡ. Hãy tải lại template gốc.",
    });
    expect(message).toContain("Restrict Editing");
    expect(message).toContain("tải lại template gốc");
  });
});

describe("khuyết dữ liệu thì vẫn nói được điều gì đó", () => {
  it("không có location thì dùng fieldId", () => {
    expect(formatIssueMessage({ type: "missing_field", fieldId: "1419195680" })).toContain(
      "1419195680"
    );
  });

  it("không có gì cả thì không ném lỗi", () => {
    const message = formatIssueMessage({ type: "missing_field" });
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("loại lạ từ backend mới cũng không làm vỡ màn hình", () => {
    // Backend thêm một `type` mới mà FE chưa biết là chuyện sẽ xảy ra. Hiện
    // nhãn chung còn hơn hiện chuỗi rỗng hoặc ném lỗi giữa danh sách.
    const message = formatIssueMessage({
      type: "loai_moi_tinh" as FieldStructureIssue["type"],
      location: "Điều 9",
      diffPreview: "chi tiết",
    });
    expect(message).toContain("Điều 9");
    expect(message).toContain("chi tiết");
  });

  it("không lặp fieldId khi location đã chứa sẵn", () => {
    const message = formatIssueMessage({
      type: "missing_field",
      fieldId: "P1",
      location: "Vùng P1 — Số hợp đồng",
    });
    expect(message.match(/P1/g)?.length).toBe(1);
  });
});
