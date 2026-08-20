/**
 * Server-to-client push channel (US-11.2).
 *
 * The web client keeps WRITING through the existing REST routes — this
 * channel only tells it that something changed so it can invalidate the
 * matching React Query key. Nothing here is a substitute for a REST read.
 */

/** Subscribable channels. A subscriber with no filter receives all of them. */
export const REALTIME_CHANNELS = ['chat', 'tickets', 'notifications'] as const;
export type RealtimeChannel = (typeof REALTIME_CHANNELS)[number];

/** Frame names, one per channel. */
export const REALTIME_EVENTS = [
  'chat.message',
  'ticket.updated',
  'notification.created',
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

/** Which channel each event frame belongs to. */
export const CHANNEL_BY_EVENT: Readonly<
  Record<RealtimeEventName, RealtimeChannel>
> = Object.freeze({
  'chat.message': 'chat',
  'ticket.updated': 'tickets',
  'notification.created': 'notifications',
});

export type RealtimeAudienceType = 'CUSTOMER' | 'STAFF';

/**
 * A single frame, addressed to exactly one authenticated principal. Fan-out
 * to several recipients is the publisher's job — one `publish` per recipient —
 * so no subscriber can ever receive a frame addressed to someone else.
 */
export interface RealtimeEvent {
  event: RealtimeEventName;
  recipientType: RealtimeAudienceType;
  recipientId: string;
  data: Record<string, unknown>;
}
