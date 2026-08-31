/**
 * The single ERP -> stock-balance mapping.
 *
 * Stock balance is what a distributor has PAID FOR but not yet COLLECTED. The
 * ERP states both figures on every sales-order line:
 *
 *   BUSINESS_QTY            quantity ordered on the line
 *   DELIVERED_BUSINESS_QTY  quantity actually delivered against the line
 *
 *   Stock Balance = SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY)
 *
 * WHY THIS EXISTS: the home screen and the stock-balance breakdown each used
 * to derive this from the local `Purchase` / `LoadingRequest` tables, by two
 * different routes - the home card capped "loaded" per ORDER, the breakdown
 * floored "remaining" per PRODUCT after apportioning loaded quantities with a
 * round(). The two totals therefore disagreed with each other, and both
 * disagreed with the ERP. They now share this one query.
 *
 * ─── Joining a customer to their orders ─────────────────────────────────
 *
 * `raw_sales_order.CUSTOMER_ID` is the ERP's INTERNAL customer uuid
 * (dc11829d-...), not the CUSTOMER_CODE we store as `Customer.erpId`. Zero
 * sales-order rows match an erpId directly. `raw_customer` carries both, so it
 * is the bridge:
 *
 *   Customer.erpId -> raw_customer.CUSTOMER_CODE
 *                  -> raw_customer.CUSTOMER_ID
 *                  -> raw_sales_order.CUSTOMER_ID   (indexed)
 *
 * ─── Grouping ───────────────────────────────────────────────────────────
 *
 * Rows are grouped by ITEM_DESCRIPTION so the breakdown and the totals come
 * from one pass and cannot disagree. Summing per product and then totalling is
 * identical to summing every line, so the total matches the "sum per DOC_NO,
 * then add them up" definition exactly.
 *
 * Product names are the ERP's own strings and are not normalised here: the
 * feed genuinely contains near-duplicates that differ only by bracket
 * character. Merging them would be guesswork about ERP intent.
 */
export const ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL = `
    SELECT so.payload->>'ITEM_DESCRIPTION' AS product,
           sum(coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0))
             AS ordered_qty,
           sum(coalesce(nullif(so.payload->>'DELIVERED_BUSINESS_QTY', '')::numeric, 0))
             AS delivered_qty,
           -- ITEM_CODE is carried on only ~6% of line rows, and grouping is by
           -- product NAME, so take any non-null code the product's lines
           -- carry rather than dropping the whole group's code because one
           -- line is silent. min() is deterministic; a product whose lines
           -- disagree is a feed fault, not something to paper over.
           min(nullif(so.payload->>'ITEM_CODE', '')) AS item_code
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       AND so.payload->>'CUSTOMER_ID' = (
             SELECT c.payload->>'CUSTOMER_ID'
               FROM erp_raw.raw_customer c
              WHERE c.payload->>'CUSTOMER_CODE' = $1
              ORDER BY c.last_seen_at DESC NULLS LAST
              LIMIT 1)
     GROUP BY 1`;
