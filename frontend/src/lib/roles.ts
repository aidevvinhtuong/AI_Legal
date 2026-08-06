import type { UserRole } from "@/lib/types";

/** Legal / Legal Lead / IT — duyệt HĐ, xem hộp duyệt. */
export function canAccessLegalInbox(role?: UserRole | null): boolean {
  return role === "legal" || role === "legal_lead" || role === "it";
}

/** Legal / Legal Lead / IT — xem & sửa cấu hình loại HĐ. */
export function canAccessConfig(role?: UserRole | null): boolean {
  return role === "legal" || role === "legal_lead" || role === "it";
}

/** Chỉ IT — Configurations (form lists + system prompts). */
export function canAccessConfigurations(role?: UserRole | null): boolean {
  return role === "it";
}

/** @deprecated dùng canAccessConfigurations */
export function canAccessSystemPrompts(role?: UserRole | null): boolean {
  return canAccessConfigurations(role);
}

/** Quyền duyệt / hành động Legal trên chi tiết HĐ. */
export function isLegalLike(role?: UserRole | null): boolean {
  return canAccessLegalInbox(role);
}
