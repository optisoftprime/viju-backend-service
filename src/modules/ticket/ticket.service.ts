import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CreateTicketDto,
  ReplyTicketDto,
  UpdateTicketStatusDto,
} from './dto/ticket.dto';

@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(customerId: string, dto: CreateTicketDto) {
    const ticketId = `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return this.prisma.supportTicket.create({
      data: {
        ticketId,
        customerId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        attachmentUrl: dto.attachmentUrl,
      },
    });
  }

  async getCustomerTickets(customerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssignedTickets(officerId: string) {
    return this.prisma.supportTicket.findMany({
      where: { customer: { assignedOfficerId: officerId } },
      include: { customer: { select: { name: true, erpId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTicket(ticketId: string, user: any) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
        customer: true,
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    if (user.role === 'CUSTOMER' && ticket.customerId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (
      user.role === 'OFFICER' &&
      ticket.customer.assignedOfficerId !== user.id
    ) {
      throw new ForbiddenException('Access denied');
    }

    return ticket;
  }

  async replyToTicket(
    ticketId: string,
    senderId: string,
    dto: ReplyTicketDto,
    role: string,
  ) {
    const ticket = await this.getTicket(ticketId, { id: senderId, role });

    return this.prisma.ticketReply.create({
      data: {
        ticketId: ticket.id,
        senderType: role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
        customerId: role === 'CUSTOMER' ? senderId : null,
        staffId: role === 'OFFICER' || role === 'ADMIN' ? senderId : null,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
      },
    });
  }

  async updateStatus(
    ticketId: string,
    officerId: string,
    dto: UpdateTicketStatusDto,
  ) {
    const ticket = await this.getTicket(ticketId, {
      id: officerId,
      role: 'OFFICER',
    });

    return this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: dto.status },
    });
  }
}
