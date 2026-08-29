import { ERP_ORDER_STATUS_RULES_SQL } from './order-status';

/**
 * The ERP's own record of a distributor's goods movements, straight from
 * `erp_raw.raw_sales_order`.
 *
 * WHY THIS EXISTS: GET /customers/me/waybills lists LoadingRequest rows - what
 * the distributor raised through this app. This is the other side: what the
 * ERP itself holds, whether or not it ever passed through the portal. The two
 * are different resources and neither is a filter of the other.
 *
 * ─── Granularity ────────────────────────────────────────────────────────
 *
 * `raw_sales_order` is one row PER ORDER LINE. A list keyed on the line would
 * repeat the same DOC_NO once per product, so rows are rolled up to one per
 * DOC_NO - the ERP document, which is the thing a waybill IS. `lines` reports
 * how many line rows it collapsed.
 *
 * ─── Joining ────────────────────────────────────────────────────────────
 *
 * `raw_sales_order.CUSTOMER_ID` is the ERP's internal customer uuid, not the
 * CUSTOMER_CODE held as `Customer.erpId`. `erp_raw.customer_link` is the
 * ingest service's purpose-built bridge between the two, indexed on both
 * columns - cheaper and more direct than scanning `raw_customer`'s jsonb, and
 * verified to agree with it on every customer held.
 *
 * ─── Status ─────────────────────────────────────────────────────────────
 *
 * Derived with ERP_ORDER_STATUS_RULES_SQL, the same precedence the order
 * reconciler applies, so a document cannot read PROCESSING here and DELIVERED
 * on the order list.
 */
const ERP_WAYBILL_ROLLUP = `
    SELECT so.payload->>'DOC_NO' AS doc_no,
           max(so.payload->>'DOC_DATE')   AS doc_date,
           max(so.payload->>'ORDER_DATE') AS order_date,
           max(so.payload->>'CUSTOMER_ADDR_NAME') AS ship_to,
           count(*)::int AS lines,
           count(DISTINCT so.payload->>'ITEM_DESCRIPTION')::int AS products,
           bool_and(coalesce(so.payload->>'ApproveStatus', '') = 'Y') AS approved,
           bool_and(coalesce(so.payload->>'CLOSE', '0') = '2')        AS closed,
           sum(coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0))
             AS ordered_qty,
           sum(coalesce(nullif(so.payload->>'DELIVERED_BUSINESS_QTY', '')::numeric, 0))
             AS delivered_qty,
           max(so.changed_at) AS changed_at
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       AND so.payload->>'CUSTOMER_ID' = (
             SELECT cl.erp_customer_guid
               FROM erp_raw.customer_link cl
              WHERE cl.erp_customer_code = $1
              LIMIT 1)
     GROUP BY 1`;

/** One page of documents, newest first. */
export const ERP_WAYBILLS_PAGE_SQL = `
WITH a AS (${ERP_WAYBILL_ROLLUP})
SELECT a.doc_no, a.doc_date, a.order_date, a.ship_to, a.lines, a.products,
       a.ordered_qty, a.delivered_qty, a.changed_at,
       (${ERP_ORDER_STATUS_RULES_SQL}) AS status
  FROM a
 ORDER BY coalesce(a.order_date, a.doc_date) DESC NULLS LAST, a.doc_no DESC
 LIMIT $2 OFFSET $3`;

/** How many documents the ERP holds for this customer. */
export const ERP_WAYBILLS_COUNT_SQL = `
WITH a AS (${ERP_WAYBILL_ROLLUP})
SELECT count(*)::int AS n FROM a`;
