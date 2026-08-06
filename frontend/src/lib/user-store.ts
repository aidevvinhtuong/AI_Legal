/**
 * Quản lý User (IT) — mock persist localStorage.
 * Backend thật sẽ thay lớp này sau khi FE ổn định.
 */

import {
  defaultPermissionsForRole,
  normalizePermissions,
} from "@/lib/permissions";
import type {
  AppUser,
  PermissionKey,
  UserDepartment,
  UserRole,
  UserSession,
} from "@/lib/types";

const STORAGE_KEY = "ai_econtract_users_v3";

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

function nowIso() {
  return new Date().toISOString();
}

function withPermissions(
  user: Omit<AppUser, "permissions"> & { permissions?: PermissionKey[] }
): AppUser {
  return {
    ...user,
    permissions: normalizePermissions(user.permissions, user.role),
  };
}

export function defaultUsers(): AppUser[] {
  const ts = nowIso();
  const managerId = "usr_manager_pur";
  return [
    withPermissions({
      id: "usr_admin",
      username: "admin",
      password: "admin",
      email: "admin@saint-gobain.com",
      phone: "",
      department: "IT",
      role: "it",
      active: true,
      createdAt: ts,
      updatedAt: ts,
    }),
    withPermissions({
      id: managerId,
      username: "manager.pur",
      password: "demo123",
      email: "manager.pur@saint-gobain.com",
      phone: "0901000001",
      department: "Purchasing",
      role: "purchasing_manager",
      active: true,
      createdAt: ts,
      updatedAt: ts,
    }),
    withPermissions({
      id: "usr_purchasing_a",
      username: "van.a",
      password: "demo123",
      email: "purchasing@saint-gobain.com",
      phone: "0901000002",
      department: "Purchasing",
      role: "purchasing",
      lineManagerId: managerId,
      active: true,
      createdAt: ts,
      updatedAt: ts,
    }),
    withPermissions({
      id: "usr_legal",
      username: "legal",
      password: "demo123",
      email: "legal@saint-gobain.com",
      phone: "0901000003",
      department: "Legal",
      role: "legal",
      active: true,
      createdAt: ts,
      updatedAt: ts,
    }),
  ];
}

export function loadUsers(): AppUser[] {
  if (typeof window === "undefined") return defaultUsers();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = defaultUsers();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as AppUser[];
    if (!Array.isArray(parsed) || !parsed.length) return defaultUsers();
    return parsed.map((u) => withPermissions(u));
  } catch {
    return defaultUsers();
  }
}

export function saveUsers(users: AppUser[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
}

export function getUserById(id: string): AppUser | undefined {
  return loadUsers().find((u) => u.id === id);
}

export function getUserByUsername(username: string): AppUser | undefined {
  const key = username.trim().toLowerCase();
  return loadUsers().find((u) => u.username.toLowerCase() === key);
}

export function toSession(user: AppUser): UserSession {
  const permissions = normalizePermissions(user.permissions, user.role);
  return {
    token: `mock-${user.id}-token`,
    userId: user.id,
    username: user.username,
    name: user.username,
    email: user.email,
    role: user.role,
    department: user.department,
    permissions,
  };
}

export type UserInput = {
  username: string;
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

export function createUser(input: UserInput): AppUser {
  const users = loadUsers();
  const uname = input.username.trim();
  if (!uname) throw new Error("Username bắt buộc");
  if (!input.password?.trim()) throw new Error("Password bắt buộc khi tạo user");
  if (users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
    throw new Error("Username đã tồn tại");
  }
  const ts = nowIso();
  const user = withPermissions({
    id: `usr_${Date.now()}`,
    username: uname,
    password: input.password,
    email: input.email.trim(),
    phone: input.phone.trim(),
    department: input.department,
    role: input.role,
    lineManagerId: input.lineManagerId || undefined,
    permissions: input.permissions,
    active: input.active,
    createdAt: ts,
    updatedAt: ts,
  });
  users.push(user);
  saveUsers(users);
  return user;
}

export function updateUser(id: string, input: UserInput): AppUser {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("User không tồn tại");
  const uname = input.username.trim();
  if (!uname) throw new Error("Username bắt buộc");
  if (
    users.some(
      (u) => u.id !== id && u.username.toLowerCase() === uname.toLowerCase()
    )
  ) {
    throw new Error("Username đã tồn tại");
  }
  if (input.lineManagerId === id) {
    throw new Error("Line Manager không thể là chính user đó");
  }
  const prev = users[idx];
  const next = withPermissions({
    ...prev,
    username: uname,
    email: input.email.trim(),
    phone: input.phone.trim(),
    department: input.department,
    role: input.role,
    lineManagerId: input.lineManagerId || undefined,
    permissions: input.permissions,
    active: input.active,
    password: input.password?.trim() ? input.password : prev.password,
    updatedAt: nowIso(),
  });
  users[idx] = next;
  saveUsers(users);
  return next;
}

export function deleteUser(id: string) {
  const users = loadUsers();
  if (!users.some((u) => u.id === id)) throw new Error("User không tồn tại");
  const next = users
    .filter((u) => u.id !== id)
    .map((u) =>
      u.lineManagerId === id ? { ...u, lineManagerId: undefined } : u
    );
  saveUsers(next);
}

export function changePassword(
  username: string,
  oldPassword: string,
  newPassword: string
) {
  if (!newPassword.trim() || newPassword.length < 4) {
    throw new Error("Mật khẩu mới tối thiểu 4 ký tự");
  }
  const users = loadUsers();
  const idx = users.findIndex(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase()
  );
  if (idx < 0) throw new Error("Sai tài khoản hoặc mật khẩu cũ");
  if (users[idx].password !== oldPassword) {
    throw new Error("Sai tài khoản hoặc mật khẩu cũ");
  }
  if (!users[idx].active) throw new Error("Tài khoản đang bị khoá");
  users[idx] = {
    ...users[idx],
    password: newPassword,
    updatedAt: nowIso(),
  };
  saveUsers(users);
}

/** User id thuộc quyền quản lý của manager (lineManagerId = managerId). */
export function subordinateIds(managerId: string): string[] {
  return loadUsers()
    .filter((u) => u.lineManagerId === managerId && u.active)
    .map((u) => u.id);
}
