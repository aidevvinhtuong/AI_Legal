/**
 * Users (IT) — client service.
 * Mock: localStorage qua user-store. Live: REST /api/users.
 */

import { api, USE_MOCK } from "@/lib/api";
import type { AppUser } from "@/lib/types";
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
  return api.get("/api/users") as Promise<AppUser[]>;
}

export async function createUserRemote(input: UserInput): Promise<AppUser> {
  if (USE_MOCK) return createUserLocal(input);
  return api.post("/api/users", input) as Promise<AppUser>;
}

export async function updateUserRemote(
  id: string,
  input: UserInput
): Promise<AppUser> {
  if (USE_MOCK) return updateUserLocal(id, input);
  return api.put(`/api/users/${id}`, input) as Promise<AppUser>;
}

export async function deleteUserRemote(id: string): Promise<void> {
  if (USE_MOCK) {
    deleteUserLocal(id);
    return;
  }
  await api.delete(`/api/users/${id}`);
}
