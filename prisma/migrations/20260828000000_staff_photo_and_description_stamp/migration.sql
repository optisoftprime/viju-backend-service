-- Spec 42: staff profile pictures (PR-1) + the description timestamp (TS-1).
--
-- Both columns are nullable and additive, so existing rows read back null and
-- nothing already stored changes meaning. No enum is touched, so unlike the
-- OTHERS migration this needs no type swap — a plain ADD COLUMN runs fine
-- inside Prisma's transaction on PostgreSQL 10.

-- PR-1 — the staff member's own picture. `Customer.profilePhotoUrl` already
-- existed and is unchanged; this is the equivalent on the staff side, which
-- had no column at all (GET /users/me returned a hard-coded null).
ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "profilePhotoUrl" TEXT;

-- TS-1 — when the loading note was last written. Left null on every existing
-- row: back-filling it from `updatedAt` would stamp notes with the time of
-- some unrelated status change, which is the exact wrong answer this column
-- exists to avoid.
ALTER TABLE "LoadingRequest" ADD COLUMN IF NOT EXISTS "descriptionUpdatedAt" TIMESTAMP(3);
