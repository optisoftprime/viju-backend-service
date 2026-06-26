import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { paginate } from '../../common/pagination/paginate';
import {
  CreateTicketDto,
  ReplyTicketDto,
  UpdateTicketStatusDto,
} from './dto/ticket.dto';

@Injectable()
export class TicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async createTicket(customerId: string, dto: CreateTicketDto) {
    const ticketId = `TKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketId,
        customerId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        attachmentUrl: dto.attachmentUrl,
      },
    });

    // PRD §6 — notify assigned officers
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, officerAssignments: { select: { staffId: true } } },
    });
    if (customer) {
      for (const a of customer.officerAssignments) {
        await this.notifications.notify({
          recipientType: 'STAFF',
          recipientId: a.staffId,
          title: `New ticket from ${customer.name}`,
          body: `${dto.subject}`,
          type: 'TICKET_CREATED',
          data: { ticketId: ticket.id },
        });
      }
    }

    return ticket;
  }

  async getCustomerTickets(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { customerId };
    return paginate(
      () => this.prisma.supportTicket.count({ where }),
      (skip, take) =>
        this.prisma.supportTicket.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getAssignedTickets(
    officerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    // Tickets for customers this officer manages — primary OR secondary
    // (matches /officers/customers and chat access).
    const where = {
      customer: {
        OR: [
          { assignedOfficerId: officerId },
          { officerAssignments: { some: { staffId: officerId } } },
        ],
      },
    };
    return paginate(
      () => this.prisma.supportTicket.count({ where }),
      (skip, take) =>
        this.prisma.supportTicket.findMany({
          where,
          include: { customer: { select: { name: true, erpId: true } } },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getTicket(ticketId: string, user: any) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
        // Never surface the customer's auth secrets in the ticket thread.
        customer: {
          omit: { password: true, failedLoginAttempts: true, lockedUntil: true },
        },
      },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');

    if (user.role === 'CUSTOMER' && ticket.customerId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (user.role === 'OFFICER') {
      const isAssigned =
        ticket.customer.assignedOfficerId === user.id ||
        (await this.prisma.customerOfficer.findFirst({
          where: { customerId: ticket.customerId, staffId: user.id },
          select: { staffId: true },
        })) !== null;
      if (!isAssigned) throw new ForbiddenException('Access denied');
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

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId: ticket.id,
        senderType: role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
        customerId: role === 'CUSTOMER' ? senderId : null,
        staffId: role === 'OFFICER' || role === 'ADMIN' ? senderId : null,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
      },
    });

    // PRD §6 — staff reply pushes customer; customer reply notifies officers
    if (role === 'CUSTOMER') {
      const assignments = await this.prisma.customerOfficer.findMany({
        where: { customerId: ticket.customerId },
        select: { staffId: true },
      });
      for (const a of assignments) {
        await this.notifications.notify({
          recipientType: 'STAFF',
          recipientId: a.staffId,
          title: `Ticket reply: ${ticket.subject}`,
          body: dto.content.slice(0, 120),
          type: 'TICKET_REPLY_FROM_CUSTOMER',
          data: { ticketId: ticket.id },
        });
      }
    } else {
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: ticket.customerId,
        title: 'Your ticket has a new reply from your officer',
        body: dto.content.slice(0, 120),
        type: 'TICKET_REPLY_FROM_OFFICER',
        data: { ticketId: ticket.id },
      });
    }

    return reply;
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

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: dto.status },
    });

    // PRD §6 — status change pushes customer
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: ticket.customerId,
      title: 'Ticket status updated',
      body: `Your ticket status is now: ${dto.status}`,
      type: 'TICKET_STATUS_CHANGED',
      data: { ticketId: ticket.id, status: dto.status },
    });

    return updated;
  }
}
