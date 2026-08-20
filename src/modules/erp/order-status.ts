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
