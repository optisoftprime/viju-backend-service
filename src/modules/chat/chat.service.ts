import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { SendMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

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
      return this.prisma.message.findMany({
        where: { customerId: user.id, staffId: otherUserId },
        orderBy: { createdAt: 'asc' },
      });
    } else if (user.role === 'OFFICER') {
      if (!(await this.isAssignedPair(otherUserId, user.id))) {
        throw new ForbiddenException(
          'You can only chat with customers assigned to you.',
        );
      }
      return this.prisma.message.findMany({
        where: { customerId: otherUserId, staffId: user.id },
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
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
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
        type: 'CHAT_MESSAGE_FROM_OFFICER',
        data: { messageId: message.id },
      });
    } else {
      // Notify ALL officers assigned to this customer (primary + secondary)
      const assignments = await this.prisma.customerOfficer.findMany({
        where: { customerId },
        select: { staffId: true },
      });
      const recipientIds = new Set<string>(assignments.map((a) => a.staffId));
      recipientIds.add(staffId); // fallback for legacy assignedOfficerId
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
          type: 'CHAT_MESSAGE_FROM_CUSTOMER',
          data: { messageId: message.id, customerId },
        });
      }
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
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    for (const a of assignments) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: a.staffId,
        title: `New message from ${customer?.name ?? 'distributor'}`,
        body: (dto.content ?? '').slice(0, 120),
        type: 'CHAT_MESSAGE_FROM_CUSTOMER',
        data: { messageId: message.id, customerId },
      });
    }

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
