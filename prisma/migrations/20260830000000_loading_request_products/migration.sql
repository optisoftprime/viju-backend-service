-- Loading requests carry the products being loaded, the warehouse, and the
-- truck's capacity.
--
-- All three are nullable/empty for rows that predate this migration: an
-- existing loading request simply has no product breakdown, which is
-- distinguishable from one that declared an empty list only by intent, and
-- nothing reads it that way.

ALTER TABLE "LoadingRequest" ADD COLUMN "warehouseName"   TEXT;
ALTER TABLE "LoadingRequest" ADD COLUMN "loadingCapacity" INTEGER;

CREATE TABLE "LoadingRequestItem" (
  "id"               TEXT NOT NULL,
  "loadingRequestId" TEXT NOT NULL,
  "productId"        TEXT,
  "productName"      TEXT NOT NULL,
  "quantity"         INTEGER NOT NULL,
  "weightPerCarton"  DOUBLE PRECISION,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoadingRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoadingRequestItem_loadingRequestId_idx"
  ON "LoadingRequestItem"("loadingRequestId");

-- ON DELETE CASCADE: the lines have no meaning without their request.
ALTER TABLE "LoadingRequestItem" ADD CONSTRAINT "LoadingRequestItem_loadingRequestId_fkey"
  FOREIGN KEY ("loadingRequestId") REFERENCES "LoadingRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
