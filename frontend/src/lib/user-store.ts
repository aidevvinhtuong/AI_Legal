/**
 * Hằng số & helper thuần cho màn Users (IT).
 *
 * Không còn store: mọi dữ liệu user đến từ backend qua `users-service`. Ở đây
 * chỉ giữ những thứ suy ra được từ type (`UserRole`, `UserDepartment`) và các
 * helper không cần truy vấn.
 */

import { defaultPermissionsForRole } from "@/lib/permissions";
import type { PermissionKey, UserDepartment, UserRole } from "@/lib/types";

export const USER_ROLES: { value: UserRole; label: string }[] = [
  { value: "purchasing", label: "Purchasing" },
  { value: "purchasing_manager", label: "Purchasing Manager" },
  { value: "legal", label: "Legal" },
  { value: "it", label: "IT" },
];

export const USER_DEPARTMENTS: UserDepartment[] = [
  "Purchasing",
  "IT",
  "Legal",
];

export function roleLabel(role: UserRole): string {
  return USER_ROLES.find((r) => r.value === role)?.label || role;
}

export type UserInput = {
  username: string;
  fullName: string;
  password?: string;
  email: string;
  phone: string;
  department: UserDepartment;
  role: UserRole;
  lineManagerId?: string;
  permissions: PermissionKey[];
  active: boolean;
};

export function emptyUserInput(): UserInput {
  return {
    username: "",
    fullName: "",
    password: "",
    email: "",
    phone: "",
    department: "Purchasing",
    role: "purchasing",
    lineManagerId: undefined,
    permissions: defaultPermissionsForRole("purchasing"),
    active: true,
  };
}

/**
 * Họ tên hiển thị của chủ ticket.
 *
 * Backend đã trả `ownerName` trong payload review (đã join sang bảng users),
 * nên ở đây không tra cứu gì thêm — chỉ chuẩn hoá chuỗi và cắt phần chú thích
 * trong ngoặc mà dữ liệu cũ hay kèm theo.
 */
export function displayFullName(opts: {
  ownerId?: string | null;
  ownerName?: string | null;
  username?: string | null;
}): string {
  const raw = (opts.ownerName || opts.username || "").trim();
  if (!raw) return "—";
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}
