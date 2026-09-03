-- R-1 follow-up — project the ERP's customers into the portal.
--
-- The region mapping was never the problem. BP_CLUSTER_CODE 9 -> OTHERS is
-- correct everywhere; the 58 customers it covers simply had no `Customer` row,
-- so every region-scoped screen rendered empty for OTHERS. The same is true of
-- the other regions to a lesser degree: the feed holds 1,911 customers in a
-- Viju region and the external projector had copied NINE of them.
--
-- This inserts the missing ones. It never touches a row that already exists,
-- so the curated accounts keep their real phone numbers, officers and history.
--
-- The rules live in `src/modules/erp/customer-projection.ts`, which is the
-- authority and applies the same statement on a timer; this is the one-off
-- backfill so a deploy does not have to wait for the first pass.
--
-- ─── The phone number ──────────────────────────────────────────────────
--
-- Projected rows get a synthetic `ERP-<CUSTOMER_CODE>` phone, NOT the feed's.
-- This is a security matter, not tidiness: across the 1,911 mapped customers
-- the feed states 1,909 numbers drawn from twelve distinct values, one of them
-- repeated 1,897 times. `Customer.phone` is unique and is the LOGIN
-- IDENTIFIER for both the OTP and password flows, so copying the feed's value
-- would put 1,897 distributors on one login. `password` is left NULL, so these
-- rows are directory entries rather than accounts until onboarding sets a
-- real, verified number.
--
-- ─── Which rows ────────────────────────────────────────────────────────
--
-- Only BP_CLUSTER_CODEs the mapping knows: 1-5 and 9. GZ001, GZ020 and GH100
-- are other group entities' customer-coding schemes, not Viju territories, and
-- stay out - they remain visible in the dashboard's `unmappedRegionCount`.
--
-- Guarded on the feed being present, so this is a no-op on a database without
-- erp_raw (CI, a fresh local environment).

DO $$
BEGIN
  IF to_regclass('erp_raw.raw_customer') IS NOT NULL THEN
    INSERT INTO "Customer" (id, "erpId", name, phone, region, "accountStatus", "updatedAt")
    SELECT gen_random_uuid(),
           v.erp_id,
           v.name,
           'ERP-' || v.erp_id,
           (CASE v.cluster_code
              WHEN '1' THEN 'LAGOS'
              WHEN '2' THEN 'EASTERN'
              WHEN '3' THEN 'SOUTH_SOUTH'
              WHEN '4' THEN 'WESTERN'
              WHEN '5' THEN 'NORTH'
              WHEN '9' THEN 'OTHERS'
            END)::"Region",
           'ACTIVE'::"AccountStatus",
           now()
      FROM (
        SELECT DISTINCT ON (payload->>'CUSTOMER_CODE')
               payload->>'CUSTOMER_CODE'   AS erp_id,
               coalesce(
                 nullif(trim(payload->>'CUSTOMER_NAME'), ''),
                 nullif(trim(payload->>'CUSTOMER_FULL_NAME'), ''),
                 'ERP ' || (payload->>'CUSTOMER_CODE')
               )                           AS name,
               payload->>'BP_CLUSTER_CODE' AS cluster_code
          FROM erp_raw.raw_customer
         WHERE payload->>'BP_CLUSTER_CODE' IN ('1', '2', '3', '4', '5', '9')
           AND coalesce(payload->>'CUSTOMER_CODE', '') <> ''
         ORDER BY payload->>'CUSTOMER_CODE', last_seen_at DESC NULLS LAST
      ) v
     WHERE NOT EXISTS (
       SELECT 1 FROM "Customer" c WHERE c."erpId" = v.erp_id
     )
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;
