import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationGateway, NotificationPayload } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NotificationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Records the in-app notification + best-effort push dispatch.
   * Push failures are isolated — a broken FCM gateway must NEVER fail
   * the calling business flow (chat send, ticket reply, waybill submit,
   * broadcast, etc.). Everything downstream of the DB write is wrapped
   * so the bell-icon notification still lands even if push is down.
   */
  async notify(payload: NotificationPayload): Promise<void> {
    // 1) DB row — this we DO want to fail loud if it errors,
    //    since it's the source of truth for the bell icon.
    const row = await this.prisma.notification.create({
      data: {
        // On a CUSTOMER row `customerId` IS the recipient. On a STAFF row it
        // is the distributor the notification is about (N-1), and `staffId`
        // alone identifies the recipient - which is what makes a staff row
        // and a customer-feed row tellable apart.
        customerId:
          payload.recipientType === 'CUSTOMER'
            ? payload.recipientId
            : (payload.subjectCustomerId ?? null),
        staffId: payload.recipientType === 'STAFF' ? payload.recipientId : null,
        // P-3 - `content` overrides the default composition when the copy must
        // reach the recipient verbatim (a broadcast is the admin's own words).
        content: payload.content ?? `${payload.title}: ${payload.body}`,
        type: payload.type,
      },
    });

    // 1b) Realtime frame (US-11.2) so an open web session sees the bell
    //     update without waiting out its query cache. Publishing is
    //     non-throwing by contract — the row above is what counts.
    this.realtime.publish({
      event: 'notification.created',
      recipientType: payload.recipientType,
      recipientId: payload.recipientId,
      data: {
        id: row.id,
        content: row.content,
        type: row.type,
        isRead: row.isRead,
        createdAt: row.createdAt,
      },
    });

    // 2) Push dispatch — best-effort, never throws back to the caller.
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: {
          isActive: true,
          ...(payload.recipientType === 'CUSTOMER'
            ? { customerId: payload.recipientId }
            : { staffId: payload.recipientId }),
        },
        select: { token: true },
      });

      if (tokens.length === 0) return;

      const result = await this.gateway.dispatch(
        payload,
        tokens.map((t) => t.token),
      );

      if (result.tokensRemovedAsInvalid.length > 0) {
        await this.prisma.pushToken.updateMany({
          where: { token: { in: result.tokensRemovedAsInvalid } },
          data: { isActive: false },
        });
      }
    } catch (e) {
      this.logger.error(
        `Push dispatch failed for ${payload.recipientType}:${payload.recipientId} — ${(e as Error).message}. ` +
          `In-app notification still recorded.`,
      );
    }
  }
}
