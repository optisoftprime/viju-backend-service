import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SendMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getMessages(user: any, otherUserId: string) {
    if (user.role === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({ where: { id: user.id } });
      if (customer?.assignedOfficerId !== otherUserId) {
        throw new ForbiddenException('You can only chat with your assigned account officer.');
      }
      return this.prisma.message.findMany({
        where: { customerId: user.id, staffId: otherUserId },
        orderBy: { createdAt: 'asc' },
      });
    } else if (user.role === 'OFFICER') {
      const customer = await this.prisma.customer.findUnique({ where: { id: otherUserId } });
      if (customer?.assignedOfficerId !== user.id) {
        throw new ForbiddenException('You can only chat with customers assigned to you.');
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
      const customer = await this.prisma.customer.findUnique({ where: { id: user.id } });
      if (customer?.assignedOfficerId !== receiverId) {
        throw new ForbiddenException('You can only send messages to your assigned account officer.');
      }
      customerId = user.id;
      staffId = receiverId;
      senderType = 'CUSTOMER';
    } else if (user.role === 'OFFICER') {
      const customer = await this.prisma.customer.findUnique({ where: { id: receiverId } });
      if (customer?.assignedOfficerId !== user.id) {
        throw new ForbiddenException('You can only send messages to your assigned customers.');
      }
      customerId = receiverId;
      staffId = user.id;
      senderType = 'STAFF';
    }

    return this.prisma.message.create({
      data: {
        customerId,
        staffId,
        senderType,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
      },
    });
  }

  async getAudits(adminId: string, customerId: string) {
    return this.prisma.message.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' }
    });
  }
}
