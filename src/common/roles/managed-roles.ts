import { StaffRole } from '@prisma/client';

/**
 * Single source of truth for the staff roles this service owns outright.
 *
 * The PRD names them ADMIN, REGIONAL_ADMIN, ACCOUNT_OFFICER and
 * LOADING_OFFICER. This codebase has always called an account officer
 * `OFFICER` (Staff.role, the @Roles() guards, the /admin/officers routes and
 * the FE contract all use it), so that value is kept and ACCOUNT_OFFICER is
 * accepted only as an input alias — see `normalizeManagedRole()`.
 *
 * "Managed" means: created, deactivated and reactivated by an ADMIN through
 * /admin/officers, and NEVER created, resurrected, retired or re-roled by an
 * ERP sync. The service database is the source of truth for these four.
 *
 * WAREHOUSE_OFFICER is deliberately absent. It is still mirrored from the ERP
 * on web login (see AuthService.staffWebLogin), so admin lifecycle operations
 * refuse it rather than half-managing an account the ERP will overwrite.
 */
export const MANAGED_STAFF_ROLES = [
  StaffRole.ADMIN,
  StaffRole.REGIONAL_ADMIN,
  StaffRole.OFFICER,
  StaffRole.LOADING_OFFICER,
] as const;

export type ManagedStaffRole = (typeof MANAGED_STAFF_ROLES)[number];

/** The same list as plain strings, for Swagger `enum:` and @IsIn(). */
export const MANAGED_STAFF_ROLE_VALUES: readonly string[] = MANAGED_STAFF_ROLES;

/**
 * Roles the caller may send to POST /admin/officers, including the PRD's
 * ACCOUNT_OFFICER spelling. Anything outside this list is a 400 — a client
 * cannot mint a WAREHOUSE_OFFICER, and an unknown string cannot slip through.
 */
export const ACCOUNT_OFFICER_ALIAS = 'ACCOUNT_OFFICER';
export const CREATABLE_STAFF_ROLE_VALUES: readonly string[] = [
  ...MANAGED_STAFF_ROLE_VALUES,
  ACCOUNT_OFFICER_ALIAS,
];

/** True when this service — not the ERP — owns the account's lifecycle. */
export function isManagedStaffRole(
  role: string | null | undefined,
): role is ManagedStaffRole {
  return typeof role === 'string' && MANAGED_STAFF_ROLE_VALUES.includes(role);
}

/**
 * Folds the PRD's ACCOUNT_OFFICER spelling onto the stored OFFICER value.
 * Returns null for anything that is not a managed role, so callers can fail
 * closed instead of trusting the string.
 */
export function normalizeManagedRole(
  role: string | null | undefined,
): ManagedStaffRole | null {
  if (role === ACCOUNT_OFFICER_ALIAS) return StaffRole.OFFICER;
  return isManagedStaffRole(role) ? role : null;
}

/**
 * Managed roles whose work is scoped to one region, so a region is required
 * at creation. ADMIN is org-wide and stays regionless (Staff.region is
 * nullable and every region-scoped endpoint treats a null ADMIN region as
 * "all regions").
 */
export const REGION_REQUIRED_STAFF_ROLES: readonly ManagedStaffRole[] = [
  StaffRole.REGIONAL_ADMIN,
  StaffRole.OFFICER,
  StaffRole.LOADING_OFFICER,
];

export function requiresRegion(role: ManagedStaffRole): boolean {
  return REGION_REQUIRED_STAFF_ROLES.includes(role);
}
