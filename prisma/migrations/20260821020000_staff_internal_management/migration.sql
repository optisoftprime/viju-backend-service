-- Internally managed staff accounts (ADMIN, REGIONAL_ADMIN, OFFICER,
-- LOADING_OFFICER). The service database is now the source of truth for their
-- lifecycle, so record WHO created / deactivated / reactivated each account
-- and WHEN. All columns are nullable: rows that predate this migration have
-- no recorded actor, and `isActive` already carries the current status.

ALTER TABLE "Staff" ADD COLUMN "createdById"     TEXT;
ALTER TABLE "Staff" ADD COLUMN "deactivatedAt"   TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "deactivatedById" TEXT;
ALTER TABLE "Staff" ADD COLUMN "reactivatedAt"   TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "reactivatedById" TEXT;

-- ON DELETE SET NULL: removing an admin must never cascade into the accounts
-- they administered — the audit row survives with an unknown actor instead.
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_deactivatedById_fkey"
  FOREIGN KEY ("deactivatedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_reactivatedById_fkey"
  FOREIGN KEY ("reactivatedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the deactivation stamp for accounts an admin had already retired,
-- so the audit view does not show them as "never deactivated" while inactive.
-- The actor is unknown for these, which is why deactivatedById stays NULL.
UPDATE "Staff" SET "deactivatedAt" = "updatedAt" WHERE "isActive" = false;

-- The managed-user list filters on role + status (GET /admin/officers).
CREATE INDEX "Staff_role_isActive_idx" ON "Staff"("role", "isActive");
