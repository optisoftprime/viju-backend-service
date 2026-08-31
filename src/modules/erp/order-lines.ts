/**
 * The single ERP -> order line-item mapping.
 *
 * WHY THIS EXISTS: `PurchaseItem` is populated by the projector in the ingest
 * service, and it has copied lines for 30 of 10,350 orders. Every other order
 * detail screen renders an empty line list. The lines themselves are in the
 * feed, one row per line, keyed to the order by DOC_NO - which is exactly
 * `Purchase.erpId`, so no id bridge is needed here.
 *
 *   ITEM_DESCRIPTION  product name
 *   ITEM_CODE         ERP item code, e.g. '101010317'
 *   BUSINESS_QTY      quantity on this line
 *   PRICE             unit price on this line
 *   AMOUNT            line total
 *   DCMS_ROWNUM       the ERP's own line ordering
 *
 * ─── Two corrections to what this file used to say ──────────────────────
 *
 * 1. The code was read from `ITEM_ID`, which is a GUID
 *    ('218137e0-e453-41fa-c378-14c55f840acd'), not a code. `ITEM_CODE` is the
 *    real one ('101010317') and matches the product specification sheet.
 *
 * 2. This file claimed the feed carried no per-line money, on the strength of
 *    `AMT_UNINCLUDE_TAX_OC` (the ORDER total repeated per line) and
 *    `PRICE_QTY1` (a mirror of BUSINESS_QTY). It does carry it, in `PRICE`
 *    and `AMOUNT`: on order 2300-201808010026 line 2 reads PRICE 1150 against
 *    BUSINESS_QTY 200 for AMOUNT 230,000, which is exactly per-line.
 *
 * ─── Coverage ───────────────────────────────────────────────────────────
 *
 * ITEM_CODE, PRICE and AMOUNT are populated on 56,766 of 993,979 line rows
 * (5.7%), spread across the whole 2018-2026 range rather than concentrated in
 * recent orders. A line the feed is silent about returns NULL for all three -
 * never an apportioned guess, because products on one order carry different
 * prices and a split would look authoritative while disagreeing with the ERP.
 */
export const ERP_ORDER_LINES_SQL = `
    SELECT so.payload->>'DOC_NO'           AS doc_no,
           so.payload->>'ITEM_DESCRIPTION' AS product_name,
           so.payload->>'ITEM_CODE'        AS item_code,
           coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0) AS quantity,
           nullif(so.payload->>'PRICE',  '')::numeric AS unit_price,
           nullif(so.payload->>'AMOUNT', '')::numeric AS amount,
           so.payload->>'DCMS_ROWNUM'      AS row_num,
           so.id                           AS row_id
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       AND so.payload->>'DOC_NO' = ANY($1)
     ORDER BY so.payload->>'DOC_NO', so.payload->>'DCMS_ROWNUM', so.id`;
