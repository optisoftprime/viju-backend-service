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
 *   ITEM_ID           ERP item code
 *   BUSINESS_QTY      quantity on this line
 *   DCMS_ROWNUM       the ERP's own line ordering
 *
 * ─── What the feed does NOT carry ───────────────────────────────────────
 *
 * There is no per-line price or amount. `AMT_UNINCLUDE_TAX_OC` is the ORDER
 * total repeated on every line - on order 2300-201902010013 all four lines
 * read 258,000 across yoghurt and water, which plainly cannot be per-line -
 * and `PRICE_QTY1` simply mirrors BUSINESS_QTY.
 *
 * So `unitPrice` and `lineTotal` come back NULL rather than apportioned. The
 * order total could be split across lines by quantity, but products on one
 * order have different prices, so that would invent per-line money that looks
 * authoritative and disagrees with the ERP. The order-level `totalValue` is
 * real and is still returned beside the lines.
 */
export const ERP_ORDER_LINES_SQL = `
    SELECT so.payload->>'DOC_NO'           AS doc_no,
           so.payload->>'ITEM_DESCRIPTION' AS product_name,
           so.payload->>'ITEM_ID'          AS item_code,
           coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0) AS quantity,
           so.payload->>'DCMS_ROWNUM'      AS row_num,
           so.id                           AS row_id
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       AND so.payload->>'DOC_NO' = ANY($1)
     ORDER BY so.payload->>'DOC_NO', so.payload->>'DCMS_ROWNUM', so.id`;
