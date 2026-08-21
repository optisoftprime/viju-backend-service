-- Bring Customer.outstandingBalance into step with the ERP customer-credit feed.
--
-- Background: customer rows are written by a projector that lives in another
-- service, and that projector copies the ERP's raw CREDIT_PAY straight into
-- the balance column. CREDIT_PAY is the credit a customer has CONSUMED, signed
-- from the ERP's point of view: positive means owing, negative means the
-- customer is in credit. Copying it verbatim therefore INVERTS the balance for
-- every customer holding credit — 1,473 of the 1,831 customers in the feed
-- (80%). ISEA INTEGRATED (10110017) reads -33,401,031.14, i.e. "owes ₦33.4m",
-- when the ERP in fact has it ₦33.4m in credit.
--
-- The balance is instead derived from the three credit fields:
--
--   Running Balance = CREDIT_AMT + CREDIT_AMT1 - CREDIT_PAY
--
--   CREDIT_AMT   approved credit limit
--   CREDIT_AMT1  supplementary allocation granted per FUND_DESC (floor-stock
--                credit, special approvals). Already resolved by the ERP, so
--                it is summed as-is and never re-derived here.
--   CREDIT_PAY   credit consumed; subtracted, not copied.
--
-- The result is NOT rounded: the ERP carries up to 4dp on the credit fields
-- and every decimal survives into the balance, so ISEA INTEGRATED (10110017)
-- lands on 33403031.4733 rather than 33403031.47. The arithmetic runs in
-- `numeric` (exact decimal), and only the store into the DOUBLE PRECISION
-- column casts to float8.
--
-- The rules below are the same ones `src/modules/erp/account-balance.ts`
-- applies at runtime — that file is the authority; this is the one-off
-- backfill of existing rows. Both steps are guarded on the feed being present,
-- so this migration is a no-op on a database without erp_raw (CI, a fresh
-- local environment).

-- 1. Index the customer code the rollup joins on.
--
--    NOTE FOR THE INGEST TEAM: this indexes a table owned by the ERP ingest.
--    It is additive and drops nothing, but a non-CONCURRENT CREATE INDEX takes
--    a brief write lock on raw_customer_credit (well under a second at the
--    current 1.8k rows), so an in-flight ingest run will wait rather than
--    fail. Prisma runs each migration in a transaction, which rules out
--    CONCURRENTLY here.
DO $$
BEGIN
  IF to_regclass('erp_raw.raw_customer_credit') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS raw_customer_credit_customer_code_idx
      ON erp_raw.raw_customer_credit ((payload->>'CUSTOMER_CODE'));
  END IF;
END
$$;

-- 2. Back-fill the balances that are wrong today.
--
--    DISTINCT ON takes the newest credit record per customer by
--    EFFECTIVE_DATE. The feed currently holds exactly one row per customer,
--    but this stays correct if the ERP starts versioning them.
--
--    `updatedAt` is stamped from the ERP row's own `changed_at` rather than
--    now(), because the app surfaces that column as the balance's
--    `lastUpdated` — it should say when the BALANCE moved, not when this
--    migration ran. Customers with no credit record in the feed are left
--    exactly as they are rather than being zeroed, and only rows whose derived
--    balance actually differs are touched.
DO $$
BEGIN
  IF to_regclass('erp_raw.raw_customer_credit') IS NOT NULL THEN
    WITH derived AS (
      SELECT DISTINCT ON (r.payload->>'CUSTOMER_CODE')
             r.payload->>'CUSTOMER_CODE' AS erp_id,
                 coalesce(nullif(r.payload->>'CREDIT_AMT',  '')::numeric, 0)
               + coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0)
               - coalesce(nullif(r.payload->>'CREDIT_PAY',  '')::numeric, 0)
                 AS running_balance,
             r.changed_at AS changed_at
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' IN (SELECT "erpId" FROM "Customer")
       ORDER BY r.payload->>'CUSTOMER_CODE',
                r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
                r.id DESC
    )
    UPDATE "Customer" c
       SET "outstandingBalance" = d.running_balance::float8,
           "updatedAt"          = coalesce(d.changed_at, now())
      FROM derived d
     WHERE c."erpId" = d.erp_id
       AND c."outstandingBalance" IS DISTINCT FROM d.running_balance::float8;
  END IF;
END
$$;
