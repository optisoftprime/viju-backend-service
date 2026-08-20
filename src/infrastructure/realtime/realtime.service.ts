import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import {
  CHANNEL_BY_EVENT,
  RealtimeAudienceType,
  RealtimeChannel,
  RealtimeEvent,
  RealtimeEventName,
} from './realtime.types';

/** The shape Nest's `@Sse()` serialises into an `event:`/`data:` frame. */
export interface RealtimeMessageEvent {
  type: RealtimeEventName;
  data: Record<string, unknown>;
}

/**
 * In-process event bus behind GET /realtime/stream.
 *
 * Single-node by design, matching how the app is deployed today: every
 * subscriber is attached to the same process that publishes. If the API is
 * ever scaled horizontally this Subject becomes the one thing to replace
 * (Redis pub/sub or similar) — nothing else in the codebase touches it, since
 * publishers only call `publish()` and the controller only calls `streamFor()`.
 *
 * Publishing NEVER throws back into the calling business flow: a realtime
 * frame is a hint, and a dropped hint must not fail a chat send or a ticket
 * update. The REST read is always the source of truth.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('RealtimeService');
  private readonly events$ = new Subject<RealtimeEvent>();

  publish(event: RealtimeEvent): void {
    try {
      this.events$.next(event);
    } catch (e) {
      this.logger.error(
        `Realtime publish failed for ${event.event} -> ` +
          `${event.recipientType}:${event.recipientId} — ${(e as Error).message}`,
      );
    }
  }

  /**
   * Frames addressed to this principal, optionally narrowed to a subset of
   * channels. Completing/erroring is left to the HTTP connection lifecycle —
   * Nest unsubscribes when the client disconnects.
   */
  streamFor(
    recipient: { type: RealtimeAudienceType; id: string },
    channels?: RealtimeChannel[],
  ): Observable<RealtimeMessageEvent> {
    const wanted = channels?.length ? new Set(channels) : null;
    return this.events$.pipe(
      filter(
        (e) =>
          e.recipientType === recipient.type &&
          e.recipientId === recipient.id &&
          (wanted === null || wanted.has(CHANNEL_BY_EVENT[e.event])),
      ),
      map((e) => ({ type: e.event, data: e.data })),
    );
  }
}
