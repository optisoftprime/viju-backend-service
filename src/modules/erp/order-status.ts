import { OrderStatus } from '@prisma/client';

/**
 * B-5.3 — the single ERP-state → order-status mapping.
 *
 * Order status used to be defaulted to PROCESSING, so every transaction on the
 * mobile app read "Processing" regardless of what had actually happened. This
 * table is the published mapping both clients render from, so web and mobile
 * cannot word the same order differently.
 *
 * Keys are matched case-insensitively after trimming, so an ERP that starts
 * sending "Closed" instead of "CLOSED" keeps working.
 */
export const ORDER_STATUS_BY_ERP_STATE: Readonly<Record<string, OrderStatus>> =
  Object.freeze({
    // Raised, not yet acted on
    PENDING: OrderStatus.PENDING,
    NEW: OrderStatus.PENDING,
    OPEN: OrderStatus.PENDING,
    UNAPPROVED: OrderStatus.PENDING,
    AWAITING_APPROVAL: OrderStatus.PENDING,

    // Approved and being worked
    PROCESSING: OrderStatus.PROCESSING,
    APPROVED: OrderStatus.PROCESSING,
    IN_PROGRESS: OrderStatus.PROCESSING,
    PARTIALLY_DELIVERED: OrderStatus.PROCESSING,

    // Goods loaded onto a truck
    LOADED: OrderStatus.LOADED,
    LOADING_COMPLETED: OrderStatus.LOADED,

    // Left the warehouse
    DISPATCHED: OrderStatus.DISPATCHED,
    SHIPPED: OrderStatus.DISPATCHED,
    IN_TRANSIT: OrderStatus.DISPATCHED,

    // Received by the distributor
    DELIVERED: OrderStatus.DELIVERED,
    RECEIVED: OrderStatus.DELIVERED,

    // Settled and closed off in the ERP
    CLOSED: OrderStatus.CLOSED,
    COMPLETED: OrderStatus.CLOSED,
    SETTLED: OrderStatus.CLOSED,
    FINISHED: OrderStatus.CLOSED,

    // Cancelled
    CANCELLED: OrderStatus.CANCELLED,
    CANCELED: OrderStatus.CANCELLED,
    VOID: OrderStatus.CANCELLED,
    REJECTED: OrderStatus.CANCELLED,
  });

/**
 * Maps an ERP order state onto the portal enum.
 *
 * An unrecognised state falls back to PENDING — never a raw ERP string, and
 * never a misleading PROCESSING, which is what made every order look like it
 * was mid-flight.
 */
export function orderStatusFromErp(state: unknown): OrderStatus {
  if (typeof state !== 'string') return OrderStatus.PENDING;
  const key = state
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return ORDER_STATUS_BY_ERP_STATE[key] ?? OrderStatus.PENDING;
}

/**
 * True when the ERP state is one this mapping recognises. Callers can use it
 * to log the unmapped states worth adding above.
 */
export function isKnownErpOrderState(state: unknown): boolean {
  if (typeof state !== 'string') return false;
  const key = state
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return key in ORDER_STATUS_BY_ERP_STATE;
}

/**
 * B-5.5 — deriving order status from the `erp_raw` sales-order feed.
 *
 * The push webhook above only fires when the ERP calls us. The bulk of the
 * data arrives the other way: the ingest writes ERP rows into
 * `erp_raw.raw_sales_order` and a projector (in another service) copies them
 * into `Purchase`. That projector writes a constant PROCESSING, which is why
 * every order on the app read "Processing" no matter what the ERP said.
 *
 * The feed carries no single status column, so the state is rolled up from the
 * signals it does carry. `raw_sales_order` is one row PER ORDER LINE, keyed to
 * an order by DOC_NO, so every signal is aggregated across the lines:
 *
 *   ApproveStatus          'Y' approved; anything else ('V') not yet approved
 *   CLOSE                  '2' the ERP has closed the order off; '0'/null open
 *   BUSINESS_QTY           quantity ordered on the line
 *   DELIVERED_BUSINESS_QTY quantity actually delivered against the line
 *
 * Rules, in precedence order:
 *
 *   any line not approved            -> PENDING
 *   every line closed                -> CLOSED     (terminal; outranks delivery)
 *   delivered >= ordered (ordered>0) -> DELIVERED
 *   otherwise                        -> PROCESSING (approved, in flight)
 *
 * Two states are deliberately unreachable from this feed, rather than faked:
 *
 *   LOADED / DISPATCHED  DISTRIBUTED_BUS_QTY is 0 on every row in the feed and
 *                        `raw_sales_delivery` carries no key back to the order,
 *                        so there is no honest loading/dispatch signal. These
 *                        stay reachable only via the push webhook.
 *   CANCELLED            the feed exposes no cancel/void flag. 'V' rows never
 *                        have deliveries, so they are read as not-yet-approved
 *                        (PENDING), not as cancelled.
 */
export const ERP_ORDER_STATUS_RULES_SQL = `
      CASE
        WHEN NOT a.approved                                          THEN 'PENDING'
        WHEN a.closed                                                THEN 'CLOSED'
        WHEN a.ordered_qty > 0 AND a.delivered_qty >= a.ordered_qty   THEN 'DELIVERED'
        ELSE 'PROCESSING'
      END`;

/**
 * Rolls the per-line ERP rows up to one row per order (DOC_NO).
 *
 * Restricted to the orders we actually hold, so this stays a 5k-row index
 * lookup instead of a 350k-row sort over the whole feed.
 */
export const ERP_ORDER_ROLLUP_SQL = `
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
     GROUP BY 1`;

/**
 * The whole reconcile as one set-based statement.
 *
 * `statusUpdatedAt` moves only when the status actually changes, and it is
 * stamped with the ERP row's own `changed_at` rather than "now", so the app
 * shows when the ORDER changed, not when we last looked.
 */
export const ERP_ORDER_STATUS_RECONCILE_SQL = `
WITH agg AS (${ERP_ORDER_ROLLUP_SQL}),
derived AS (
  SELECT pu.id,
         (${ERP_ORDER_STATUS_RULES_SQL})::"OrderStatus" AS status,
         a.changed_at
    FROM "Purchase" pu
    JOIN agg a ON a.doc_no = pu."erpId"
)
UPDATE "Purchase" p
   SET status = d.status,
       "statusUpdatedAt" = coalesce(d.changed_at, now())
  FROM derived d
 WHERE p.id = d.id
   AND p.status IS DISTINCT FROM d.status`;

/** Display wording, so both clients label a status identically. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> =
  Object.freeze({
    [OrderStatus.PENDING]: 'Pending',
    [OrderStatus.PROCESSING]: 'Processing',
    [OrderStatus.LOADED]: 'Loaded',
    [OrderStatus.DISPATCHED]: 'Dispatched',
    [OrderStatus.DELIVERED]: 'Delivered',
    [OrderStatus.CLOSED]: 'Closed',
    [OrderStatus.CANCELLED]: 'Cancelled',
    [OrderStatus.SHIPPED]: 'Dispatched',
  });
