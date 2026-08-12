import { hasPermission } from "@/lib/permissions";
import type { PermissionKey, UserRole, UserSession } from "@/lib/types";
import { defaultPermissionsForRole } from "@/lib/permissions";

type RoleOrSession = UserRole | UserSession | null | undefined;

function asSession(input: RoleOrSession): {
  role?: UserRole | null;
  permissions?: PermissionKey[];
} {
  if (!input) return {};
  if (typeof input === "string") {
    return { role: input, permissions: defaultPermissionsForRole(input) };
  }
  return {
    role: input.role,
    permissions:
      input.permissions?.length
        ? input.permissions
        : defaultPermissionsForRole(input.role),
  };
}

function check(input: RoleOrSession, key: PermissionKey): boolean {
  const { permissions } = asSession(input);
  return hasPermission(permissions, key);
}

/** Task inbox / duyệt. */
export function canAccessLegalInbox(input?: RoleOrSession): boolean {
  // Hàng chờ Legal: cần quyền task + role legal-like (hoặc IT demo)
  const { role, permissions } = asSession(input);
  if (!hasPermission(permissions, "task")) return false;
  return role === "legal" || role === "legal_lead" || role === "it";
}

/** Cấu hình loại HĐ (checklist). */
export function canAccessConfig(input?: RoleOrSession): boolean {
  return check(input, "contract_config");
}

/** Configurations — Form lists, System prompts và/hoặc Phân quyền ký. */
export function canAccessConfigurations(input?: RoleOrSession): boolean {
  const { permissions } = asSession(input);
  return (
    hasPermission(permissions, "form_lists") ||
    hasPermission(permissions, "system_prompts") ||
    hasPermission(permissions, "contract_config")
  );
}

export function canAccessFormLists(input?: RoleOrSession): boolean {
  return check(input, "form_lists");
}

export function canAccessSystemPrompts(input?: RoleOrSession): boolean {
  return check(input, "system_prompts");
}

/** Quản lý Users. */
export function canAccessUsers(input?: RoleOrSession): boolean {
  return check(input, "users");
}

export function canCreateContracts(input?: RoleOrSession): boolean {
  return check(input, "contracts_create");
}

export function canAccessContractsList(input?: RoleOrSession): boolean {
  return check(input, "contracts");
}

export function canAccessTasks(input?: RoleOrSession): boolean {
  return check(input, "task");
}

/** Quyền duyệt / hành động Legal trên chi tiết HĐ. */
export function isLegalLike(role?: UserRole | null): boolean {
  return role === "legal" || role === "legal_lead" || role === "it";
}

export function isPurchasingLike(role?: UserRole | null): boolean {
  return role === "purchasing" || role === "purchasing_manager";
}
