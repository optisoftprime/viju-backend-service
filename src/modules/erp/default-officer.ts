import { Region, isRegion } from '../../common/region/region.constants';

/**
 * The account officer ERP-sourced LAGOS customers fall back to.
 *
 * WHY THIS EXISTS: portal `Customer` rows are written by a projector that
 * lives in the ingest service, and that projector knows nothing about staff —
 * it leaves `assignedOfficerId` NULL. A customer with no officer has no chat
 * counterparty, no ticket owner and no notification recipient, so the portal
 * effectively drops them. Until the ERP carries a real customer→officer
 * mapping, unassigned customers are parked on one default officer.
 *
 * SCOPED TO ONE REGION. Only customers in `DEFAULT_ACCOUNT_OFFICER_REGION`
 * (LAGOS unless overridden) are parked. That is not an arbitrary limit: an
 * officer belongs to a region (PRD Section 8), and `AdminService`
 * .reassignAllCustomers validates a bulk move against the SOURCE officer's
 * region — so parking, say, a NORTH customer on a LAGOS officer would create
 * a portfolio that the bulk-reassign route could never unwind. Customers
 * outside the region are left unassigned for a regional officer to pick up.
 *
 * "Unless they reassign" falls out of the WHERE clause rather than needing a
 * flag: the reconcile only ever touches customers whose `assignedOfficerId`
 * IS NULL, so an admin reassignment (PATCH /admin/customers/:id/reassign) is
 * permanent — the next pass sees a non-NULL pointer and skips the row.
 */

/** Default when `DEFAULT_ACCOUNT_OFFICER_EMAIL` is unset. */
export const FALLBACK_DEFAULT_OFFICER_EMAIL = 'james.o@viju.example';

/** Default when `DEFAULT_ACCOUNT_OFFICER_REGION` is unset. */
export const FALLBACK_DEFAULT_OFFICER_REGION: Region = 'LAGOS';

/** Email of the officer unassigned customers are parked on. */
export function defaultAccountOfficerEmail(): string {
  const raw = process.env.DEFAULT_ACCOUNT_OFFICER_EMAIL;
  if (raw === undefined || raw.trim() === '')
    return FALLBACK_DEFAULT_OFFICER_EMAIL;
  return raw.trim().toLowerCase();
}

/**
 * The ONLY region whose unassigned customers get parked on that officer.
 *
 * An unrecognised value falls back to LAGOS rather than throwing: a typo in
 * the environment must not widen the scope, and it must not take the app down
 * either. The caller logs the rejection.
 */
export function defaultAccountOfficerRegion(): Region {
  const raw = process.env.DEFAULT_ACCOUNT_OFFICER_REGION;
  if (raw === undefined || raw.trim() === '')
    return FALLBACK_DEFAULT_OFFICER_REGION;
  const candidate = raw.trim().toUpperCase();
  return isRegion(candidate) ? candidate : FALLBACK_DEFAULT_OFFICER_REGION;
}

/** True when the environment names a region that is not a Viju region. */
export function hasInvalidRegionOverride(): boolean {
  const raw = process.env.DEFAULT_ACCOUNT_OFFICER_REGION;
  if (raw === undefined || raw.trim() === '') return false;
  return !isRegion(raw.trim().toUpperCase());
}

/**
 * Park every unassigned customer IN ONE REGION on the default officer, in a
 * single statement.
 *
 * `$1` is the officer's Staff id and `$2` the region — both resolved by the
 * caller so it can log a useful message when the officer row is missing, and
 * both passed as bind parameters rather than interpolated.
 *
 * Both sides of the assignment are written, exactly as
 * `AdminService.movePrimaryAssignment` does for a manual reassignment:
 *
 *   1. `Customer.assignedOfficerId` — the primary pointer the officer portal,
 *      admin lists and dashboards read.
 *   2. A primary `CustomerOfficer` row — what chat threads, tickets and
 *      notification fan-out resolve through. Writing only (1) would leave an
 *      officer who owns the customer but receives none of their messages.
 *
 * `updatedAt` is deliberately NOT bumped. The customer portal reports it as
 * `walletBalance.lastUpdated` and the officer portal as the `lastContactDate`
 * fallback; touching it here would date-stamp a wallet and a conversation that
 * did not change.
 *
 * Idempotent and safe to run repeatedly: rows that already have an officer are
 * excluded by the WHERE, and a pre-existing CustomerOfficer row (the customer
 * was a SECONDARY of the default officer) is promoted rather than duplicated.
 */
export const DEFAULT_OFFICER_RECONCILE_SQL = `
WITH claimed AS (
  UPDATE "Customer"
     SET "assignedOfficerId" = $1::text
   WHERE "assignedOfficerId" IS NULL
     AND region = $2::"Region"
  RETURNING id AS customer_id
)
INSERT INTO "CustomerOfficer" (id, "customerId", "staffId", "isPrimary", "assignedAt")
SELECT gen_random_uuid()::text, customer_id, $1::text, true, now()
  FROM claimed
     ON CONFLICT ("customerId", "staffId")
     DO UPDATE SET "isPrimary" = true
`;
