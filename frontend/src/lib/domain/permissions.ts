/**
 * Phân quyền theo hạng mục — IT tick trên màn Users.
 * Role chỉ là gợi ý mặc định; quyền thực tế = permissions[] trên user.
 */

import type { PermissionKey, UserRole } from "@/lib/domain/types";

export type { PermissionKey };

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  description: string;
  group: string;
};

/** Danh mục hiển thị trên UI tick (thứ tự cố định). */
export const PERMISSION_CATALOG: PermissionDef[] = [
  {
    key: "task",
    label: "Task",
    description: "Xem và xử lý hàng chờ Task (duyệt / rejected).",
    group: "Nghiệp vụ",
  },
  {
    key: "contracts",
    label: "Danh sách hợp đồng",
    description: "Xem danh sách HĐ / Tất cả hợp đồng.",
    group: "Nghiệp vụ",
  },
  {
    key: "contracts_create",
    label: "Tạo tài liệu (Add)",
    description: "Nút Add / tạo review mới + upload file.",
    group: "Nghiệp vụ",
  },
  {
    key: "contract_config",
    label: "Cấu hình hợp đồng",
    description: "Xem / sửa / lưu checklist · matrix theo loại HĐ.",
    group: "Cấu hình",
  },
  {
    key: "form_lists",
    label: "Form lists",
    description: "Configurations → danh mục dropdown form tạo HĐ.",
    group: "Cấu hình",
  },
  {
    key: "system_prompts",
    label: "System prompts",
    description: "Configurations → sửa System Prompt AI.",
    group: "Cấu hình",
  },
  {
    key: "users",
    label: "Users",
    description: "Quản lý tài khoản và phân quyền.",
    group: "Hệ thống",
  },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);

/** Quyền mặc định khi chọn Role (IT có thể tick thêm/bớt sau). */
export function defaultPermissionsForRole(role: UserRole): PermissionKey[] {
  switch (role) {
    case "it":
      return [...ALL_KEYS];
    case "legal":
      return ["task", "contracts", "contract_config"];
    case "purchasing_manager":
      return ["task", "contracts"];
    case "purchasing":
      return ["task", "contracts", "contracts_create"];
    default:
      return ["task", "contracts"];
  }
}

export function isPermissionKey(v: unknown): v is PermissionKey {
  return typeof v === "string" && (ALL_KEYS as string[]).includes(v);
}

export function normalizePermissions(
  raw: unknown,
  role: UserRole
): PermissionKey[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultPermissionsForRole(role);
  }
  const set = new Set<PermissionKey>();
  for (const item of raw) {
    if (isPermissionKey(item)) set.add(item);
    // Legacy: Publish checklist → gộp vào Cấu hình hợp đồng
    else if (item === "contract_config_publish") set.add("contract_config");
  }
  return ALL_KEYS.filter((k) => set.has(k));
}

export function hasPermission(
  permissions: PermissionKey[] | undefined | null,
  key: PermissionKey
): boolean {
  return !!permissions?.includes(key);
}

export function permissionLabels(permissions: PermissionKey[]): string {
  if (!permissions.length) return "—";
  return permissions
    .map((k) => PERMISSION_CATALOG.find((p) => p.key === k)?.label || k)
    .join(", ");
}
