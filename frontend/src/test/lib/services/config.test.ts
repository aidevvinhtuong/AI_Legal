/**
 * Quyền cấu hình.
 *
 * ## Về nhánh fallback theo chỉ số
 *
 * `getConfigPermission()` từng lùi về `DEFAULT_CONFIG_PERMISSIONS[2]` — bám vào
 * **thứ tự phần tử trong mảng**. Xoá `legal_lead` (vai trò đã bỏ từ Blueprint
 * v1.8) làm chỉ số đó trượt từ `purchasing` sang `admin`.
 *
 * **Chưa gây hậu quả**, vì `mapped` luôn là một trong ba giá trị có sẵn trong
 * bảng nên `find` không bao giờ trượt xuống fallback. Đã đổi sang tra theo tên
 * vì đó là loại mã chỉ chờ ai nới `mapped` ra là thành lỗ cấp quyền thật.
 *
 * Nên bộ này KHÔNG giả vờ là test regression cho một lỗ hổng — nó chốt **hành vi
 * ánh xạ quyền**, thứ thật sự chạy trong đường chính.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_PERMISSIONS } from "@/lib/domain/config-types";
import { getConfigPermission } from "@/lib/services/config";
import type { UserRole } from "@/lib/domain/types";

function login(role: UserRole, permissions: string[] = []) {
  localStorage.setItem(
    "user",
    JSON.stringify({ token: "t", userId: "u", username: role, role, permissions })
  );
  localStorage.setItem("token", "t");
}

describe("vai trò không nhận ra", () => {
  it("lùi về quyền của purchasing, KHÔNG phải admin", () => {
    // Đây là hành vi thật sự chạy: `mapped` quy mọi vai trò lạ về "purchasing".
    const p = getConfigPermission("khong-ton-tai" as UserRole);
    expect(p.canView).toBe(false);
    expect(p.canEditDraft).toBe(false);
    expect(p.canViewAudit).toBe(false);

    const admin = DEFAULT_CONFIG_PERMISSIONS.find((x) => x.role === "admin");
    expect(admin!.canEditDraft).toBe(true);
    expect(p).not.toEqual(admin);
  });

  it("legal_lead đã bỏ hẳn khỏi bảng mặc định", () => {
    expect(DEFAULT_CONFIG_PERMISSIONS.map((p) => p.role)).not.toContain("legal_lead");
  });
});

describe("ánh xạ vai trò", () => {
  beforeEach(() => localStorage.clear());

  it("legal xem và sửa được cấu hình", () => {
    const p = getConfigPermission("legal");
    expect(p.canView).toBe(true);
    expect(p.canEditDraft).toBe(true);
  });

  it("purchasing không đụng được cấu hình", () => {
    const p = getConfigPermission("purchasing");
    expect(p.canView).toBe(false);
    expect(p.canEditDraft).toBe(false);
  });

  it("it xem được audit", () => {
    expect(getConfigPermission("it").canViewAudit).toBe(true);
  });
});

describe("tick quyền trên user thắng vai trò mặc định", () => {
  it("purchasing được IT tick contract_config thì xem được", () => {
    // Blueprint VI.5.3.1: role chỉ quyết định bộ MẶC ĐỊNH, quyền thật đọc từ
    // `users.permissions` do IT tick.
    login("purchasing", ["task", "contracts", "contract_config"]);
    const p = getConfigPermission();
    expect(p.canView).toBe(true);
    expect(p.canEditDraft).toBe(true);
  });

  it("legal bị thu quyền contract_config thì hết xem được", () => {
    login("legal", ["task", "contracts"]);
    expect(getConfigPermission().canView).toBe(false);
  });
});
