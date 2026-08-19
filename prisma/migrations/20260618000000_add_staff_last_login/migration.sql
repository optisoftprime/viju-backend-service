-- Track the staff member's most recent successful login (for the
-- admin officer-detail view). Nullable: existing rows have no value yet.
ALTER TABLE "Staff" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
