import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { SendMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Every officer who currently manages this customer - the primary
   * (Customer.assignedOfficerId) plus every CustomerOfficer row.
   *
   * US-13.5: derived from the CURRENT assignment on every call, so a
   * reassignment moves the thread, the notifications and the bell over to the
   * new officer with nothing copied and nothing orphaned on the old one.
   */
  private async currentOfficerIds(customerId: string): Promise<string[]> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        assignedOfficerId: true,
        officerAssignments: { select: { staffId: true } },
      },
    });
    if (!customer) return [];
    const ids = new Set<string>(
      customer.officerAssignments.map((a) => a.staffId),
    );
    if (customer.assignedOfficerId) ids.add(customer.assignedOfficerId);
    return [...ids];
  }

  /** Publishes one `chat.message` frame per live recipient (US-11.2). */
  private publishMessage(
    message: {
      id: string;
      content: string | null;
      attachmentUrl: string | null;
      createdAt: Date;
    },
    senderId: string,
    recipients: { type: 'CUSTOMER' | 'STAFF'; id: string }[],
  ): void {
    for (const recipient of recipients) {
      this.realtime.publish({
        event: 'chat.message',
        recipientType: recipient.type,
        recipientId: recipient.id,
        data: {
          id: message.id,
          senderId,
          receiverId: recipient.id,
          content: message.content,
          attachmentUrl: message.attachmentUrl,
          createdAt: message.createdAt,
        },
      });
    }
  }

  /**
   * True if the officer manages the customer — as primary (assignedOfficerId)
   * OR secondary (CustomerOfficer). Mirrors OfficerService.ensureAssignedCustomer
   * and GET /officers/customers, so chat access matches the assigned list.
   */
  private async isAssignedPair(
    customerId: string,
    officerId: string,
  ): Promise<boolean> {
    const match = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        OR: [
          { assignedOfficerId: officerId },
          { officerAssignments: { some: { staffId: officerId } } },
        ],
      },
      select: { id: true },
    });
    return !!match;
  }

  async getMessages(user: any, otherUserId: string) {
    if (user.role === 'CUSTOMER') {
      if (!(await this.isAssignedPair(user.id, otherUserId))) {
        throw new ForbiddenException(
          'You can only chat with your assigned account officer.',
        );
      }
      // US-13.5: the whole thread for this account, not only the messages
      // that happen to carry one officer's id. A reassignment must not hide
      // history from either side.
      return this.prisma.message.findMany({
        where: { customerId: user.id },
        orderBy: { createdAt: 'asc' },
      });
    } else if (user.role === 'OFFICER') {
      if (!(await this.isAssignedPair(otherUserId, user.id))) {
        throw new ForbiddenException(
          'You can only chat with customers assigned to you.',
        );
      }
      // Same guarantee from the officer side: a newly assigned officer sees
      // every pre-existing message, and the previous officer - no longer
      // assigned - is refused by the check above.
      return this.prisma.message.findMany({
        where: { customerId: otherUserId },
        orderBy: { createdAt: 'asc' },
      });
    }
  }

  async sendMessage(user: any, receiverId: string, dto: SendMessageDto) {
    let customerId = '';
    let staffId = '';
    let senderType = '';

    if (user.role === 'CUSTOMER') {
      if (!(await this.isAssignedPair(user.id, receiverId))) {
        throw new ForbiddenException(
          'You can only send messages to your assigned account officer.',
        );
      }
      customerId = user.id;
      staffId = receiverId;
      senderType = 'CUSTOMER';
    } else if (user.role === 'OFFICER') {
      if (!(await this.isAssignedPair(receiverId, user.id))) {
        throw new ForbiddenException(
          'You can only send messages to your assigned customers.',
        );
      }
      customerId = receiverId;
      staffId = user.id;
      senderType = 'STAFF';
    }

    const message = await this.prisma.message.create({
      data: {
        customerId,
        staffId,
        senderType,
        content: dto.content?.trim() || null,
        attachmentUrl: dto.attachmentUrl || null,
      },
    });

    // PRD §6 notification triggers
    if (senderType === 'STAFF') {
      // Customer-facing display name is always 'Viju Account Officer' (PRD F6)
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: customerId,
        title: 'Viju Account Officer',
        body: (dto.content ?? '').slice(0, 120),
        type: NotificationTypes.CHAT_MESSAGE,
        data: { messageId: message.id },
      });
      this.publishMessage(message, staffId, [
        { type: 'CUSTOMER', id: customerId },
      ]);
    } else {
      // US-11.8: notify every officer who currently manages this customer,
      // primary and secondary. Derived from the live assignment so a
      // reassigned officer starts receiving these immediately and the
      // previous one stops.
      const recipientIds = new Set<string>(
        await this.currentOfficerIds(customerId),
      );
      recipientIds.add(staffId); // the officer the message was addressed to
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });
      for (const recipientId of recipientIds) {
        await this.notifications.notify({
          recipientType: 'STAFF',
          recipientId,
          title: `New message from ${customer?.name ?? 'distributor'}`,
          body: (dto.content ?? '').slice(0, 120),
          type: NotificationTypes.CHAT_MESSAGE,
          data: { messageId: message.id, customerId },
        });
      }
      this.publishMessage(
        message,
        customerId,
        [...recipientIds].map((id) => ({ type: 'STAFF' as const, id })),
      );
    }

    return message;
  }

  async getAudits(adminId: string, customerId: string) {
    return this.prisma.message.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * PRD F6: Customer-facing chat thread. Both officers route through
   * here; messages from either officer appear under 'Viju Account Officer'.
   */
  async getCustomerThread(customerId: string) {
    const messages = await this.prisma.message.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        content: true,
        attachmentUrl: true,
        senderType: true,
        createdAt: true,
        readAt: true,
      },
    });
    return messages.map((m) => ({
      ...m,
      senderLabel: m.senderType === 'STAFF' ? 'Viju Account Officer' : 'You',
    }));
  }

  /**
   * PRD F6: Customer sends to their account-officer team. They don't pick
   * a specific officer — the message is recorded against the primary
   * officer; both primary + secondary are notified.
   */
  async sendFromCustomer(customerId: string, dto: SendMessageDto) {
    const assignments = await this.prisma.customerOfficer.findMany({
      where: { customerId },
      orderBy: { isPrimary: 'desc' },
      select: { staffId: true, isPrimary: true },
    });
    if (assignments.length === 0) {
      // Legacy fallback — single assigned officer
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { assignedOfficerId: true },
      });
      if (!customer?.assignedOfficerId) {
        throw new ForbiddenException(
          'No account officer is assigned to your account yet. Please contact Viju.',
        );
      }
      assignments.push({
        staffId: customer.assignedOfficerId,
        isPrimary: true,
      });
    }

    const primary = assignments[0];
    const message = await this.prisma.message.create({
      data: {
        customerId,
        staffId: primary.staffId,
        senderType: 'CUSTOMER',
        content: dto.content?.trim() || null,
        attachmentUrl: dto.attachmentUrl || null,
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    // Union with the live assignment so the officer a reassignment just
    // pointed at is notified even before a CustomerOfficer row exists.
    const recipientIds = new Set<string>([
      ...assignments.map((a) => a.staffId),
      ...(await this.currentOfficerIds(customerId)),
    ]);
    for (const recipientId of recipientIds) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId,
        title: `New message from ${customer?.name ?? 'distributor'}`,
        body: (dto.content ?? '').slice(0, 120),
        type: NotificationTypes.CHAT_MESSAGE,
        data: { messageId: message.id, customerId },
      });
    }
    this.publishMessage(
      message,
      customerId,
      [...recipientIds].map((id) => ({ type: 'STAFF' as const, id })),
    );

    return {
      ...message,
      senderLabel: 'You',
    };
  }

  async markCustomerThreadRead(customerId: string) {
    await this.prisma.message.updateMany({
      where: { customerId, senderType: 'STAFF', readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
