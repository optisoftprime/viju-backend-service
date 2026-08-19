-- Region enum realignment: the ERP identifies a customer's region with a
-- numeric BP_CLUSTER_CODE (1-5) instead of a region name. The enum is
-- re-declared in BP_CLUSTER_CODE order and gains SOUTH_SOUTH, which the old
-- four-value enum had no equivalent for.
--
--   BP_CLUSTER_CODE 1 -> LAGOS        (BP_CLUSTER_NAME "LAGOS区")
--   BP_CLUSTER_CODE 2 -> EASTERN      ("EASTERN东区")
--   BP_CLUSTER_CODE 3 -> SOUTH_SOUTH  ("SOUTH-SOUTH南区")
--   BP_CLUSTER_CODE 4 -> WESTERN      ("WESTERN西")
--   BP_CLUSTER_CODE 5 -> NORTH        ("NORTH 北")
--
-- Step 2 converts the columns with a literal rename (SOUTH_WEST -> WESTERN,
-- SOUTH_EAST -> EASTERN) so the migration works on any database, including a
-- fresh one with no ERP data.
--
-- Step 4 then corrects Customer.region from the authoritative BP_CLUSTER_CODE
-- in erp_raw.raw_customer where that feed is present. This matters: the
-- pre-migration Customer.region values were placeholders that did not agree
-- with the ERP, so the rename alone would carry the wrong region forward.
-- Staff has no BP_CLUSTER_CODE (internal accounts), so the rename stands.

-- 1. New type, declared in BP_CLUSTER_CODE order.
CREATE TYPE "Region_new" AS ENUM ('LAGOS', 'EASTERN', 'SOUTH_SOUTH', 'WESTERN', 'NORTH');

-- 2. Move every column across, translating the retired values on the way.
ALTER TABLE "Customer"
  ALTER COLUMN "region" TYPE "Region_new"
  USING (
    CASE "region"::text
      WHEN 'SOUTH_WEST' THEN 'WESTERN'
      WHEN 'SOUTH_EAST' THEN 'EASTERN'
      ELSE "region"::text
    END
  )::"Region_new";

ALTER TABLE "Staff"
  ALTER COLUMN "region" TYPE "Region_new"
  USING (
    CASE "region"::text
      WHEN 'SOUTH_WEST' THEN 'WESTERN'
      WHEN 'SOUTH_EAST' THEN 'EASTERN'
      ELSE "region"::text
    END
  )::"Region_new";

ALTER TABLE "LoadingRequest"
  ALTER COLUMN "region" TYPE "Region_new"
  USING (
    CASE "region"::text
      WHEN 'SOUTH_WEST' THEN 'WESTERN'
      WHEN 'SOUTH_EAST' THEN 'EASTERN'
      ELSE "region"::text
    END
  )::"Region_new";

-- Array column: translate element by element, preserving order. ALTER ... USING
-- cannot contain a subquery, so this uses array_replace rather than unnest.
ALTER TABLE "Broadcast"
  ALTER COLUMN "targetRegions" TYPE "Region_new"[]
  USING (
    array_replace(
      array_replace("targetRegions"::text[], 'SOUTH_WEST', 'WESTERN'),
      'SOUTH_EAST', 'EASTERN'
    )
  )::"Region_new"[];

-- 3. Swap the types over.
ALTER TYPE "Region" RENAME TO "Region_old";
ALTER TYPE "Region_new" RENAME TO "Region";
DROP TYPE "Region_old";

-- 4. Re-derive Customer.region from the ERP's BP_CLUSTER_CODE where available.
--    Guarded so the migration still runs on databases without the erp_raw feed.
--    Codes outside 1-5 (e.g. 9, GZ001, GZ020) map to NULL and are skipped,
--    leaving those customers on their converted value.
DO $$
BEGIN
  IF to_regclass('erp_raw.raw_customer') IS NOT NULL THEN
    UPDATE "Customer" c
    SET "region" = derived.region
    FROM (
      SELECT c2.id,
             (CASE latest.payload->>'BP_CLUSTER_CODE'
                WHEN '1' THEN 'LAGOS'
                WHEN '2' THEN 'EASTERN'
                WHEN '3' THEN 'SOUTH_SOUTH'
                WHEN '4' THEN 'WESTERN'
                WHEN '5' THEN 'NORTH'
              END)::"Region" AS region
      FROM "Customer" c2
      CROSS JOIN LATERAL (
        SELECT r.payload
        FROM erp_raw.raw_customer r
        WHERE r.payload->>'CUSTOMER_CODE' = c2."erpId"
        ORDER BY r.last_seen_at DESC NULLS LAST
        LIMIT 1
      ) AS latest
    ) AS derived
    WHERE c.id = derived.id
      AND derived.region IS NOT NULL
      AND c."region" IS DISTINCT FROM derived.region;
  END IF;
END
$$;
