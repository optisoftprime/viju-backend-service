-- A loading request can span several orders.
--
-- The order moves onto the LINE: `LoadingRequest.linkedPurchaseId` names only
-- the primary order, while each line records which order its product came
-- from. Both columns are nullable, so lines written before this migration
-- simply do not say - they all belonged to the request's single linked order.
--
-- `orderReference` is the ERP DOC_NO, denormalised so a line can still report
-- its origin if the local Purchase row is ever removed.

ALTER TABLE "LoadingRequestItem" ADD COLUMN "purchaseId"     TEXT;
ALTER TABLE "LoadingRequestItem" ADD COLUMN "orderReference" TEXT;

CREATE INDEX "LoadingRequestItem_purchaseId_idx"
  ON "LoadingRequestItem"("purchaseId");

-- ON DELETE SET NULL: removing an order must not delete the record of what was
-- loaded. `orderReference` survives as the trace.
ALTER TABLE "LoadingRequestItem" ADD CONSTRAINT "LoadingRequestItem_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
