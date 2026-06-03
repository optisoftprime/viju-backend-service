import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationGateway, NotificationPayload } from './notification.types';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
  ) {}

  async notify(payload: NotificationPayload): Promise<void> {
    await this.prisma.notification.create({
      data: {
        customerId:
          payload.recipientType === 'CUSTOMER' ? payload.recipientId : null,
        staffId: payload.recipientType === 'STAFF' ? payload.recipientId : null,
        content: `${payload.title}: ${payload.body}`,
        type: payload.type,
      },
    });

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
  }
}
