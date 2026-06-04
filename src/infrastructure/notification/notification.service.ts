import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationGateway, NotificationPayload } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger('NotificationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
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
    await this.prisma.notification.create({
      data: {
        customerId:
          payload.recipientType === 'CUSTOMER' ? payload.recipientId : null,
        staffId:
          payload.recipientType === 'STAFF' ? payload.recipientId : null,
        content: `${payload.title}: ${payload.body}`,
        type: payload.type,
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
