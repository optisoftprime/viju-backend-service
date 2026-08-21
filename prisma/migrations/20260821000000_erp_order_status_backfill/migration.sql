-- B-5.5 — bring Purchase.status into step with the ERP sales-order feed.
--
-- Background: order rows are written by a projector that lives in another
-- service, and that projector stores a constant PROCESSING. Every order in
-- this database therefore read "Processing" — including orders the ERP closed
-- off years ago — and `statusUpdatedAt` was NULL on all of them.
--
-- The feed carries no status column. The state is rolled up per order (DOC_NO)
-- from the signals `erp_raw.raw_sales_order` does carry. The rules below are
-- the same ones `src/modules/erp/order-status.ts` applies at runtime — that
-- file is the authority; this is the one-off backfill of existing rows.
--
--   any line ApproveStatus <> 'Y'   -> PENDING     (not yet approved)
--   every line CLOSE = '2'          -> CLOSED      (terminal, outranks delivery)
--   delivered >= ordered, ordered>0 -> DELIVERED
--   otherwise                       -> PROCESSING  (approved, in flight)
--
-- Both steps are guarded on the feed being present, so this migration is a
-- no-op on a database without erp_raw (CI, a fresh local environment).

-- 1. Index the order number the rollup groups on.
--
--    Without it, rolling the feed up is a ~350k-row sequential scan plus an
--    on-disk sort (~14s measured). With it the reconcile is an index lookup
--    per held order.
--
--    NOTE FOR THE INGEST TEAM: this indexes a table owned by the ERP ingest.
--    It is additive and drops nothing, but a non-CONCURRENT CREATE INDEX takes
--    a brief write lock on raw_sales_order (seconds at current volume), so an
--    in-flight ingest run will wait rather than fail. Prisma runs each
--    migration in a transaction, which rules out CONCURRENTLY here.
DO $$
BEGIN
  IF to_regclass('erp_raw.raw_sales_order') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS raw_sales_order_doc_no_idx
      ON erp_raw.raw_sales_order ((payload->>'DOC_NO'));
  END IF;
END
$$;

-- 2. Back-fill the statuses that are wrong today.
--
--    `statusUpdatedAt` is stamped from the ERP row's own `changed_at` rather
--    than now(), so the app shows when the ORDER last changed, not when this
--    migration ran. Only rows whose derived status actually differs are
--    touched.
DO $$
BEGIN
  IF to_regclass('erp_raw.raw_sales_order') IS NOT NULL THEN
    WITH agg AS (
      SELECT r.payload->>'DOC_NO' AS doc_no,
             bool_and(coalesce(r.payload->>'ApproveStatus', '') = 'Y') AS approved,
             bool_and(coalesce(r.payload->>'CLOSE', '0') = '2')        AS closed,
             sum(coalesce(nullif(r.payload->>'BUSINESS_QTY', '')::numeric, 0))
               AS ordered_qty,
             sum(coalesce(nullif(r.payload->>'DELIVERED_BUSINESS_QTY', '')::numeric, 0))
               AS delivered_qty,
             max(r.changed_at) AS changed_at
        FROM erp_raw.raw_sales_order r
       WHERE r.object_type = 'SALES_ORDER'
         AND r.payload->>'DOC_NO' IN (SELECT "erpId" FROM "Purchase")
       GROUP BY 1
    ),
    derived AS (
      SELECT pu.id,
             (CASE
                WHEN NOT a.approved                                        THEN 'PENDING'
                WHEN a.closed                                              THEN 'CLOSED'
                WHEN a.ordered_qty > 0 AND a.delivered_qty >= a.ordered_qty THEN 'DELIVERED'
                ELSE 'PROCESSING'
              END)::"OrderStatus" AS status,
             a.changed_at
        FROM "Purchase" pu
        JOIN agg a ON a.doc_no = pu."erpId"
    )
    UPDATE "Purchase" p
       SET status = d.status,
           "statusUpdatedAt" = coalesce(d.changed_at, now())
      FROM derived d
     WHERE p.id = d.id
       AND p.status IS DISTINCT FROM d.status;
  END IF;
END
$$;
