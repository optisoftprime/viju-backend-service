import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
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
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Every officer who currently manages this customer - primary
   * (Customer.assignedOfficerId) plus every CustomerOfficer row.
   *
   * US-13.5: read from the live assignment on each call, so tickets follow a
   * reassignment automatically instead of staying with the old officer.
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

  /**
   * Publishes a `ticket.updated` frame to the customer and to every officer
   * currently on the account (US-11.2), so open sessions refresh their ticket
   * list without waiting out the query cache.
   */
  private async publishTicketUpdate(ticket: {
    id: string;
    ticketId: string;
    customerId: string;
    status: string;
  }): Promise<void> {
    const data = {
      id: ticket.id,
      ticketId: ticket.ticketId,
      status: ticket.status,
    };
    this.realtime.publish({
      event: 'ticket.updated',
      recipientType: 'CUSTOMER',
      recipientId: ticket.customerId,
      data,
    });
    for (const staffId of await this.currentOfficerIds(ticket.customerId)) {
      this.realtime.publish({
        event: 'ticket.updated',
        recipientType: 'STAFF',
        recipientId: staffId,
        data,
      });
    }
  }

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

    // PRD §6 / US-11.8 - notify every officer currently on the account, so a
    // ticket raised right after a reassignment still reaches someone.
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    for (const staffId of await this.currentOfficerIds(customerId)) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: staffId,
        title: `New ticket from ${customer?.name ?? 'distributor'}`,
        body: `${dto.subject}`,
        type: NotificationTypes.TICKET_CREATED,
        data: { ticketId: ticket.id },
      });
    }
    await this.publishTicketUpdate(ticket);

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
          omit: {
            password: true,
            failedLoginAttempts: true,
            lockedUntil: true,
          },
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

    // PRD §6 - staff reply pushes the customer (US-11.7); a customer reply
    // notifies every officer currently on the account.
    if (role === 'CUSTOMER') {
      for (const staffId of await this.currentOfficerIds(ticket.customerId)) {
        await this.notifications.notify({
          recipientType: 'STAFF',
          recipientId: staffId,
          title: `Ticket reply: ${ticket.subject}`,
          body: dto.content.slice(0, 120),
          type: NotificationTypes.TICKET_REPLY,
          data: { ticketId: ticket.id },
        });
      }
    } else {
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: ticket.customerId,
        title: 'Your ticket has a new reply from your officer',
        body: dto.content.slice(0, 120),
        type: NotificationTypes.TICKET_REPLY,
        data: { ticketId: ticket.id },
      });
    }
    await this.publishTicketUpdate(ticket);

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

    // PRD §6 / US-11.7 - status change pushes the customer
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: ticket.customerId,
      title: 'Ticket status updated',
      body: `Your ticket status is now: ${dto.status}`,
      type: NotificationTypes.TICKET_STATUS,
      data: { ticketId: ticket.id, status: dto.status },
    });
    await this.publishTicketUpdate(updated);

    return updated;
  }
}
