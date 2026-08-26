-- Spec 39: the OTHERS region (R-1) + the loading-request flow columns (L-1, L-2).
--
-- ─── R-1: why this is a type swap and not ALTER TYPE ... ADD VALUE ───────
--
-- The obvious one-liner is:
--
--     ALTER TYPE "Region" ADD VALUE 'OTHERS';
--
-- It does not work here. This database is PostgreSQL 10, where ADD VALUE
-- cannot run inside a transaction block, and Prisma wraps every migration in
-- one. `prisma migrate deploy` would fail with:
--
--     ERROR: ALTER TYPE ... ADD cannot run inside a transaction block
--
-- (PostgreSQL 12 relaxed this; upgrading the server would make the one-liner
-- viable, and this migration can be simplified when that happens.)
--
-- So the type is rebuilt and swapped, exactly as
-- 20260818000000_region_bp_cluster_code already does. Every column carrying
-- the type is moved across; nothing is renamed or dropped, so no existing
-- value changes meaning. OTHERS is appended LAST, after the five
-- BP_CLUSTER_CODE-ordered members, because it has no code of its own.
--
-- Columns carrying "Region" (verified against the live schema):
--   Customer.region        "Region"
--   Staff.region           "Region"
--   LoadingRequest.region  "Region"
--   Broadcast.targetRegions "Region"[]
--
-- ─── L-1 / L-2 ──────────────────────────────────────────────────────────
--
-- CANCELLED is ALREADY a member of LoadingRequestStatus, so no enum change is
-- needed there — only the columns that record who cancelled, when and why, and
-- the loading officer's free-text description.

-- 1. Rebuild Region with OTHERS appended.
CREATE TYPE "Region_new" AS ENUM (
  'LAGOS', 'EASTERN', 'SOUTH_SOUTH', 'WESTERN', 'NORTH', 'OTHERS'
);

-- 2. Move every column across. The USING clauses are straight text casts:
--    every existing value keeps its exact spelling.
ALTER TABLE "Customer"
  ALTER COLUMN "region" TYPE "Region_new" USING ("region"::text)::"Region_new";

ALTER TABLE "Staff"
  ALTER COLUMN "region" TYPE "Region_new" USING ("region"::text)::"Region_new";

ALTER TABLE "LoadingRequest"
  ALTER COLUMN "region" TYPE "Region_new" USING ("region"::text)::"Region_new";

-- Array column: cast through text[] element by element, preserving order.
ALTER TABLE "Broadcast"
  ALTER COLUMN "targetRegions" TYPE "Region_new"[]
  USING ("targetRegions"::text[])::"Region_new"[];

-- 3. Swap the types over.
ALTER TYPE "Region" RENAME TO "Region_old";
ALTER TYPE "Region_new" RENAME TO "Region";
DROP TYPE "Region_old";

-- 4. L-2 — the loading officer's note. Nullable: existing rows read back null,
--    which is what the frontend renders as "-".
ALTER TABLE "LoadingRequest" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- 5. L-1 — cancellation stamps. All nullable; a load that was never cancelled
--    carries nulls rather than a sentinel date.
ALTER TABLE "LoadingRequest" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "LoadingRequest" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "LoadingRequest" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
