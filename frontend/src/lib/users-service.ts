/**
 * Users (IT) — client service. Toàn bộ dữ liệu đến từ REST /api/v1/users.
 */

import { api } from "@/lib/api";
import type { AppUser, UserDirectoryEntry } from "@/lib/types";
import type { UserInput } from "@/lib/user-store";

export type { UserInput };
export {
  USER_DEPARTMENTS,
  USER_ROLES,
  emptyUserInput,
  roleLabel,
  displayFullName,
} from "@/lib/user-store";

export async function fetchUsers(): Promise<AppUser[]> {
  return api.get("/api/v1/users") as Promise<AppUser[]>;
}

/**
 * Danh bạ để chọn người ký — chỉ tên/email/điện thoại.
 *
 * KHÔNG dùng `fetchUsers()` cho việc này: `/api/v1/users` là API quản trị của
 * IT (quyền `users`), nên Legal gọi vào sẽ nhận 403 và cả bảng Phân quyền ký
 * trắng trơn. `/directory` mở cho cả `contract_config` và chỉ trả đúng những
 * trường một dropdown cần.
 */
export async function fetchUserDirectory(): Promise<UserDirectoryEntry[]> {
  return api.get("/api/v1/users/directory") as Promise<UserDirectoryEntry[]>;
}

export async function createUserRemote(input: UserInput): Promise<AppUser> {
  return api.post("/api/v1/users", input) as Promise<AppUser>;
}

export async function updateUserRemote(
  id: string,
  input: UserInput
): Promise<AppUser> {
  return api.put(`/api/v1/users/${id}`, input) as Promise<AppUser>;
}

export async function deleteUserRemote(id: string): Promise<void> {
  await api.delete(`/api/v1/users/${id}`);
}
