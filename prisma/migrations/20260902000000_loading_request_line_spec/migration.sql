-- A loading-request line records the product's specification and how much was
-- still to collect at the moment the request was made.
--
-- `spec` is ITEM_SPECIFICATION with the ERP's Chinese category characters
-- stripped. It is what separates two products the feed gives the same name -
-- VIJU MULIIFRUIT FURIT JUICE ships as both 100ML and 200ML - so without it a
-- line cannot always be tied back to a product.
--
-- `quantityLeft` is a SNAPSHOT of what the distributor was shown, not a live
-- figure. It must not move under them as later deliveries land.
--
-- Both nullable: lines written before this migration state neither.
ALTER TABLE "LoadingRequestItem" ADD COLUMN "spec"         TEXT;
ALTER TABLE "LoadingRequestItem" ADD COLUMN "quantityLeft" INTEGER;
