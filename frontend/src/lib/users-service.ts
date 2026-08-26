/**
 * Users (IT) — client service.
 * Mock: localStorage qua user-store. Live: REST /api/users.
 */

import { api, USE_MOCK } from "@/lib/api";
import type { AppUser, UserDirectoryEntry } from "@/lib/types";
import {
  createUser as createUserLocal,
  deleteUser as deleteUserLocal,
  loadUsers,
  updateUser as updateUserLocal,
  type UserInput,
} from "@/lib/user-store";

export type { UserInput };
export {
  USER_DEPARTMENTS,
  USER_ROLES,
  emptyUserInput,
  roleLabel,
  displayFullName,
  getUserById,
  subordinateIds,
} from "@/lib/user-store";

export async function fetchUsers(): Promise<AppUser[]> {
  if (USE_MOCK) return loadUsers();
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
  if (USE_MOCK) {
    return loadUsers()
      .filter((u) => u.active)
      .map(({ id, username, fullName, email, phone, active }) => ({
        id,
        username,
        fullName,
        email,
        phone,
        active,
      }));
  }
  return api.get("/api/v1/users/directory") as Promise<UserDirectoryEntry[]>;
}

export async function createUserRemote(input: UserInput): Promise<AppUser> {
  if (USE_MOCK) return createUserLocal(input);
  return api.post("/api/v1/users", input) as Promise<AppUser>;
}

export async function updateUserRemote(
  id: string,
  input: UserInput
): Promise<AppUser> {
  if (USE_MOCK) return updateUserLocal(id, input);
  return api.put(`/api/v1/users/${id}`, input) as Promise<AppUser>;
}

export async function deleteUserRemote(id: string): Promise<void> {
  if (USE_MOCK) {
    deleteUserLocal(id);
    return;
  }
  await api.delete(`/api/v1/users/${id}`);
}
