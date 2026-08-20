-- B-5.3 / B-5.4 — order lifecycle detail for the mobile transaction screens.
--
-- 1. The order status enum gains the states the ERP actually reports, so a
--    transaction stops reading "Processing" regardless of what happened to it.
--
--    This is a type swap rather than `ALTER TYPE ... ADD VALUE`, because
--    ADD VALUE cannot run inside a multi-statement migration ("ALTER TYPE ...
--    ADD cannot be executed from a function or multi-command string"). The
--    swap is the same technique 20260818000000 used for Region.
--
--    'SHIPPED' is carried over because existing rows hold it; the ERP mapping
--    no longer produces it and DISPATCHED replaces it. Nothing is dropped, so
--    no row can fail to cast.
CREATE TYPE "OrderStatus_new" AS ENUM (
  'PENDING',
  'PROCESSING',
  'LOADED',
  'DISPATCHED',
  'DELIVERED',
  'CLOSED',
  'CANCELLED',
  'SHIPPED'
);

ALTER TABLE "Purchase"
  ALTER COLUMN "status" TYPE "OrderStatus_new"
  USING "status"::text::"OrderStatus_new";

ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "OrderStatus_old";

-- 2. When the status last changed, so the app can show status freshness
--    instead of implying the order state is live.
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMP(3);

-- 3. ERP item code per order line, for the payment-detail columns (B-5.4).
ALTER TABLE "PurchaseItem" ADD COLUMN IF NOT EXISTS "itemCode" TEXT;
