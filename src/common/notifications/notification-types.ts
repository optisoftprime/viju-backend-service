/**
 * The `type` tag carried by every Notification row and every push payload.
 *
 * The web bell and the mobile app both switch on this value to pick an icon
 * and to route the click, so the set is closed and the values are stable —
 * never emit an ad-hoc string. Adding a category means adding it here first.
 */
export const NOTIFICATION_TYPE_VALUES = [
  /** A chat message arrived (either direction). */
  'CHAT_MESSAGE',
  /** A customer raised a support ticket. */
  'TICKET_CREATED',
  /** A reply was posted on a ticket thread (either direction). */
  'TICKET_REPLY',
  /** A ticket's status changed. */
  'TICKET_STATUS',
  /** A customer was assigned / reassigned to an officer. */
  'ASSIGNMENT',
  /** A distributor submitted a loading request. */
  'WAYBILL_SUBMITTED',
  /** A loading request was assigned to a loading officer. */
  'WAYBILL_ASSIGNED',
  /** A loading request moved to LOADING_IN_PROGRESS. */
  'WAYBILL_STATUS_CHANGED',
  /** A loading request was completed and the waybill recorded. */
  'WAYBILL_COMPLETED',
  /** An admin broadcast reached the distributor. */
  'BROADCAST',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPE_VALUES)[number];

/**
 * Convenience map so call sites read as `NotificationTypes.CHAT_MESSAGE`
 * rather than a bare string literal.
 */
export const NotificationTypes = Object.freeze(
  Object.fromEntries(NOTIFICATION_TYPE_VALUES.map((v) => [v, v])) as {
    [K in NotificationType]: K;
  },
);
