-- Park every LAGOS customer that has no account officer on the default officer.
--
-- Background: portal "Customer" rows are written by a projector that lives in
-- the ingest service, and that projector knows nothing about staff — it leaves
-- "assignedOfficerId" NULL. A customer with no officer has no chat
-- counterparty, no ticket owner and no notification recipient, so the officer
-- portal never shows them and messages they send reach nobody. Every customer
-- the ERP has ever fed us is in that state.
--
-- Until the ERP customer master carries a real customer→officer mapping, the
-- unassigned LAGOS ones are parked on one default officer, looked up by email.
-- `src/modules/erp/default-officer.ts` is the authority for these rules; this
-- is the one-off backfill of existing rows, and the reconcile in
-- `default-officer.service.ts` (timer + POST /erp/sync/default-officer) keeps
-- customers the projector inserts LATER in the same state.
--
-- SCOPED TO LAGOS. Customers in EASTERN, SOUTH_SOUTH, WESTERN and NORTH are
-- deliberately left unassigned for a regional officer to pick up. An officer
-- belongs to a region (PRD Section 8), and AdminService.reassignAllCustomers
-- validates a bulk move against the SOURCE officer's region — so parking a
-- NORTH customer on a LAGOS officer would build a portfolio the bulk-reassign
-- route could never unwind.
--
-- "Unless they reassign" falls out of the WHERE clause rather than needing a
-- flag: only rows whose "assignedOfficerId" IS NULL are touched, so an admin
-- reassignment via PATCH /admin/customers/:id/reassign is permanent — this
-- migration and every later reconcile pass skip a customer that already has an
-- officer.
--
-- Guarded on the officer existing, so this is a no-op on a database that has
-- not been seeded (CI, a fresh local environment) rather than a failure. The
-- reconcile picks those databases up once the Staff row appears.
--
-- NOTE: the email and region are hard-coded here because a migration cannot
-- read the app's DEFAULT_ACCOUNT_OFFICER_EMAIL / DEFAULT_ACCOUNT_OFFICER_REGION.
-- If you point those variables elsewhere, edit this file to match before
-- deploying — otherwise the backfill lands on james.o/LAGOS and the first
-- reconcile pass afterwards moves nothing (those customers are no longer NULL).
DO $$
DECLARE
  officer_id text;
  parked     integer;
BEGIN
  SELECT id INTO officer_id
    FROM "Staff"
   WHERE email = 'james.o@viju.example'
     AND role = 'OFFICER'
     AND "isActive" = true
   LIMIT 1;

  IF officer_id IS NULL THEN
    RAISE NOTICE 'No active OFFICER james.o@viju.example — skipping the default-officer backfill.';
    RETURN;
  END IF;

  -- Both sides of the assignment are written, exactly as
  -- AdminService.movePrimaryAssignment does for a manual reassignment:
  --
  --   1. "Customer"."assignedOfficerId" — the primary pointer the officer
  --      portal, admin lists and dashboards read.
  --   2. A primary "CustomerOfficer" row — what chat threads, tickets and
  --      notification fan-out resolve through. Writing only (1) would leave an
  --      officer who owns the customer but receives none of their messages.
  --
  -- "updatedAt" is deliberately NOT bumped: the customer portal reports it as
  -- walletBalance.lastUpdated and the officer portal as the lastContactDate
  -- fallback, so touching it would date-stamp a wallet and a conversation that
  -- did not change.
  WITH claimed AS (
    UPDATE "Customer"
       SET "assignedOfficerId" = officer_id
     WHERE "assignedOfficerId" IS NULL
       AND region = 'LAGOS'::"Region"
    RETURNING id AS customer_id
  )
  INSERT INTO "CustomerOfficer" (id, "customerId", "staffId", "isPrimary", "assignedAt")
  SELECT gen_random_uuid()::text, customer_id, officer_id, true, now()
    FROM claimed
  -- A customer who was already a SECONDARY of this officer (the seed does this
  -- for CUST004/CUST006) is promoted rather than duplicated.
       ON CONFLICT ("customerId", "staffId")
       DO UPDATE SET "isPrimary" = true;

  GET DIAGNOSTICS parked = ROW_COUNT;
  RAISE NOTICE 'Parked % LAGOS customer(s) with no account officer on james.o@viju.example.', parked;
END
$$;
