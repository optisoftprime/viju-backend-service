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

  async getMessages(user: any, otherUserId: string) {
    if (user.role === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: user.id },
      });
      if (customer?.assignedOfficerId !== otherUserId) {
        throw new ForbiddenException(
          'You can only chat with your assigned account officer.',
        );
      }
      return this.prisma.message.findMany({
        where: { customerId: user.id, staffId: otherUserId },
        orderBy: { createdAt: 'asc' },
      });
    } else if (user.role === 'OFFICER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: otherUserId },
      });
      if (customer?.assignedOfficerId !== user.id) {
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
      const customer = await this.prisma.customer.findUnique({
        where: { id: user.id },
      });
      if (customer?.assignedOfficerId !== receiverId) {
        throw new ForbiddenException(
          'You can only send messages to your assigned account officer.',
        );
      }
      customerId = user.id;
      staffId = receiverId;
      senderType = 'CUSTOMER';
    } else if (user.role === 'OFFICER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: receiverId },
      });
      if (customer?.assignedOfficerId !== user.id) {
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
}
