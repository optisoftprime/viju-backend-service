-- Loading quantities become fractional.
--
-- The ERP states FRACTIONAL quantities: 5,799 of the 993,985 sales-order lines
-- carry a fractional BUSINESS_QTY1, and 5,801 a fractional
-- DELIVERED_BUSINESS_QTY. `GET /erp/orders/{customerId}/products` already
-- passes those through to `quantityLeft` untouched, so a distributor could be
-- shown "12.5 left to collect" and then be unable to state it: every quantity
-- column on a loading request was an integer, which truncated the value on the
-- way in.
--
-- Widening to double precision rather than numeric to match `weightPerCarton`,
-- which is already a Float and is multiplied against `quantity` for the
-- capacity check. Both sides of that comparison are now the same kind of
-- number.
--
-- int -> double precision is a widening cast: every existing value survives
-- exactly, and no row can fail to convert.

ALTER TABLE "LoadingRequest"
  ALTER COLUMN "quantityCartons" TYPE DOUBLE PRECISION,
  ALTER COLUMN "loadingCapacity" TYPE DOUBLE PRECISION;

ALTER TABLE "LoadingRequestItem"
  ALTER COLUMN "quantity" TYPE DOUBLE PRECISION,
  ALTER COLUMN "quantityLeft" TYPE DOUBLE PRECISION;
