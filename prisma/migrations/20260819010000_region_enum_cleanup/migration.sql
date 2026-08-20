-- Finishes the region realignment started by 20260818000000_region_bp_cluster_code.
--
-- On the dev database that migration is recorded as applied, yet the Region
-- type still carries the retired SOUTH_WEST / SOUTH_EAST labels and rows still
-- hold them — most likely a later `prisma db push` re-created the type from an
-- older schema. The Prisma client only knows the five canonical values, so
-- every query that reads one of those rows fails with
-- "Value 'SOUTH_WEST' not found in enum 'Region'" — which takes out
-- GET /admin/officers and GET /admin/customers entirely.
--
-- This migration is idempotent: it inspects the type first and does nothing at
-- all on a database that is already clean, so it is safe to run everywhere.
--
--   SOUTH_WEST -> WESTERN
--   SOUTH_EAST -> EASTERN
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Region'
      AND e.enumlabel IN ('SOUTH_WEST', 'SOUTH_EAST')
  ) THEN
    RETURN;
  END IF;

  -- 1. Move every row onto a canonical value.
  UPDATE "Customer"
     SET "region" = 'WESTERN'
   WHERE "region"::text = 'SOUTH_WEST';
  UPDATE "Customer"
     SET "region" = 'EASTERN'
   WHERE "region"::text = 'SOUTH_EAST';

  UPDATE "Staff"
     SET "region" = 'WESTERN'
   WHERE "region"::text = 'SOUTH_WEST';
  UPDATE "Staff"
     SET "region" = 'EASTERN'
   WHERE "region"::text = 'SOUTH_EAST';

  UPDATE "LoadingRequest"
     SET "region" = 'WESTERN'
   WHERE "region"::text = 'SOUTH_WEST';
  UPDATE "LoadingRequest"
     SET "region" = 'EASTERN'
   WHERE "region"::text = 'SOUTH_EAST';

  -- Array column: translate element by element, preserving order.
  UPDATE "Broadcast"
     SET "targetRegions" = array_replace(
           array_replace("targetRegions"::text[], 'SOUTH_WEST', 'WESTERN'),
           'SOUTH_EAST', 'EASTERN'
         )::"Region"[]
   WHERE "targetRegions"::text[] && ARRAY['SOUTH_WEST', 'SOUTH_EAST'];

  -- 2. Retype the columns onto a clean enum. Postgres cannot drop a label from
  --    an existing type, so the type is rebuilt and swapped — the same
  --    technique 20260818000000 used.
  CREATE TYPE "Region_clean" AS ENUM ('LAGOS', 'EASTERN', 'SOUTH_SOUTH', 'WESTERN', 'NORTH');

  ALTER TABLE "Customer"
    ALTER COLUMN "region" TYPE "Region_clean" USING "region"::text::"Region_clean";
  ALTER TABLE "Staff"
    ALTER COLUMN "region" TYPE "Region_clean" USING "region"::text::"Region_clean";
  ALTER TABLE "LoadingRequest"
    ALTER COLUMN "region" TYPE "Region_clean" USING "region"::text::"Region_clean";
  ALTER TABLE "Broadcast"
    ALTER COLUMN "targetRegions" TYPE "Region_clean"[] USING "targetRegions"::text[]::"Region_clean"[];

  ALTER TYPE "Region" RENAME TO "Region_legacy";
  ALTER TYPE "Region_clean" RENAME TO "Region";
  DROP TYPE "Region_legacy";
END
$mig$;
