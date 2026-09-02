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
 *                   WHERE CLOSE = '0'
 *
 * ─── Open orders only ───────────────────────────────────────────────────
 *
 * CLOSE is the order's state, repeated on every line of the document: '0'
 * open, '2' closed. It is consistent within a document - not one of the
 * feed's 292,886 documents carries two different values - so filtering by
 * line is the same as filtering by order.
 *
 * Only open orders are counted. A closed order has been settled and is no
 * longer stock the distributor is waiting to collect. Because closed orders
 * are delivered almost in full, excluding them barely moves the REMAINING
 * figure but cuts the purchased and loaded totals by two orders of magnitude,
 * and with them `loadingProgress` - which is the point: progress against
 * what is actually outstanding, not against everything ever ordered.
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
 *
 * ─── The date window ────────────────────────────────────────────────────
 *
 * DOC_DATE is the order's own document date - the one the DOC_NO encodes
 * (2310-202606110033 -> 2026-06-11). It is stated on every one of the
 * 993,979 line rows, none of them malformed, and it agrees with the
 * projector's `Purchase.orderDate` on 40,859 of the 40,883 orders that exist
 * both ways. So the ERP path and the local fallback filter on the same notion
 * of "when the order was placed", and a distributor cannot get two different
 * answers for one window depending on which path served them.
 *
 * ORDER_DATE exists too and differs on 2,351 rows; DOC_DATE is preferred
 * because it is what the document, and therefore the distributor's paperwork,
 * is dated by.
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
           min(nullif(so.payload->>'ITEM_CODE', '')) AS item_code,
           -- The specification, but ONLY when the product appears under
           -- exactly one. Rows are grouped by product NAME, and 4 names span
           -- several sizes; handing the resolver one of them arbitrarily
           -- would attach the wrong code and carton weight to the group.
           CASE
             WHEN count(DISTINCT nullif(so.payload->>'ITEM_SPECIFICATION', '')) = 1
             THEN min(nullif(so.payload->>'ITEM_SPECIFICATION', ''))
           END AS item_specification,
           -- When this product was last ordered. A row here rolls up every
           -- line for the product across the window, so there is no single
           -- order date - the most recent one is what the screen wants.
           --
           -- Rendered to text in Postgres rather than handed back as a date,
           -- so the day cannot shift under the driver's or the app server's
           -- timezone on its way out. The cast is unconditional and safe:
           -- DOC_DATE is stated as 'YYYY-MM-DD HH:MM:SS' on all 993,979 line
           -- rows in the feed, none null and none malformed.
           to_char(max((so.payload->>'DOC_DATE')::date), 'YYYY-MM-DD')
             AS last_order_date
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       -- OPEN ORDERS ONLY. The ERP marks a sales order's state on every one
       -- of its lines: '0' is open, '2' is closed. A closed order has been
       -- settled and is no longer part of what the distributor is waiting to
       -- collect, so counting it inflates both what they "paid for" and their
       -- loading progress.
       --
       -- The effect is large and mostly on the DENOMINATOR: closed orders are
       -- 955,057 of the feed's 993,983 line rows but only 26,784 cartons of
       -- outstanding stock, because they are delivered almost in full.
       --
       -- 19,012 rows carry no CLOSE at all. The = '0' test excludes those
       -- as well, which is the rule as stated; they are 11,641 cartons.
       AND so.payload->>'CLOSE' = '0'
       AND so.payload->>'CUSTOMER_ID' = (
             SELECT c.payload->>'CUSTOMER_ID'
               FROM erp_raw.raw_customer c
              WHERE c.payload->>'CUSTOMER_CODE' = $1
              ORDER BY c.last_seen_at DESC NULLS LAST
              LIMIT 1)
       -- Optional window on the ORDER date. Both bounds are inclusive, and a
       -- NULL bound means "open ended", so one query serves the filtered and
       -- unfiltered cases. The cast is safe: every DOC_DATE in the feed is a
       -- 'YYYY-MM-DD HH:MM:SS' string.
       AND ($2::date IS NULL OR (so.payload->>'DOC_DATE')::date >= $2::date)
       AND ($3::date IS NULL OR (so.payload->>'DOC_DATE')::date <= $3::date)
     GROUP BY 1`;

/**
 * The ERP's internal customer ids for a set of CUSTOMER_CODEs.
 *
 * Resolved as its own step rather than as a subquery inside the aggregate:
 * `raw_sales_order.CUSTOMER_ID` is indexed, so feeding it an explicit list
 * keeps the index scan. Measured on the live feed, the two-step form answers a
 * portfolio in ~1.2s where the subquery form takes ~6.2s.
 *
 * $1 is a comma-separated list of codes - passed as ONE text parameter rather
 * than an array because the driver binds a plain string unambiguously.
 */
export const ERP_CUSTOMER_IDS_FOR_CODES_SQL = `
    SELECT DISTINCT c.payload->>'CUSTOMER_ID' AS id
      FROM erp_raw.raw_customer c
     WHERE c.payload->>'CUSTOMER_CODE' = ANY(string_to_array($1, ','))`;

/**
 * The same stock-balance aggregate as ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL, over
 * MANY customers at once - the account officer's whole portfolio.
 *
 * Grouped by product across every customer in the list, so the totals describe
 * the portfolio and the per-product rows add up to them, exactly as the
 * single-customer query's do for one distributor.
 *
 * $1 is a comma-separated list of ERP internal CUSTOMER_IDs (from
 * ERP_CUSTOMER_IDS_FOR_CODES_SQL), $2/$3 the optional inclusive date window.
 */
export const ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL = `
    SELECT so.payload->>'ITEM_DESCRIPTION' AS product,
           sum(coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0))
             AS ordered_qty,
           sum(coalesce(nullif(so.payload->>'DELIVERED_BUSINESS_QTY', '')::numeric, 0))
             AS delivered_qty,
           min(nullif(so.payload->>'ITEM_CODE', '')) AS item_code,
           -- The specification, but ONLY when the product appears under
           -- exactly one. Rows are grouped by product NAME, and 4 names span
           -- several sizes; handing the resolver one of them arbitrarily
           -- would attach the wrong code and carton weight to the group.
           CASE
             WHEN count(DISTINCT nullif(so.payload->>'ITEM_SPECIFICATION', '')) = 1
             THEN min(nullif(so.payload->>'ITEM_SPECIFICATION', ''))
           END AS item_specification,
           -- Same as the single-customer query: the latest DOC_DATE the
           -- product's lines carry, rendered to text in Postgres so the day
           -- cannot shift under a timezone on its way out.
           to_char(max((so.payload->>'DOC_DATE')::date), 'YYYY-MM-DD')
             AS last_order_date
      FROM erp_raw.raw_sales_order so
     WHERE so.object_type = 'SALES_ORDER'
       -- OPEN ORDERS ONLY. The ERP marks a sales order's state on every one
       -- of its lines: '0' is open, '2' is closed. A closed order has been
       -- settled and is no longer part of what the distributor is waiting to
       -- collect, so counting it inflates both what they "paid for" and their
       -- loading progress.
       --
       -- The effect is large and mostly on the DENOMINATOR: closed orders are
       -- 955,057 of the feed's 993,983 line rows but only 26,784 cartons of
       -- outstanding stock, because they are delivered almost in full.
       --
       -- 19,012 rows carry no CLOSE at all. The = '0' test excludes those
       -- as well, which is the rule as stated; they are 11,641 cartons.
       AND so.payload->>'CLOSE' = '0'
       AND so.payload->>'CUSTOMER_ID' = ANY(string_to_array($1, ','))
       AND ($2::date IS NULL OR (so.payload->>'DOC_DATE')::date >= $2::date)
       AND ($3::date IS NULL OR (so.payload->>'DOC_DATE')::date <= $3::date)
     GROUP BY 1`;
