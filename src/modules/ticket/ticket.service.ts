import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Region } from '../../common/region/region.constants';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { paginate } from '../../common/pagination/paginate';
import {
  STAFF_SENDER_SELECT,
  withStaffSenders,
} from '../../common/messaging/staff-sender';
import {
  CreateTicketDto,
  ReplyTicketDto,
  UpdateTicketStatusDto,
} from './dto/ticket.dto';

/**
 * The authenticated principal behind a ticket call, as the controller reads it
 * off the JWT. `region` is only ever populated for region-scoped staff and is
 * the ONLY source of a REGIONAL_ADMIN's scope — never a query param (B-4.2).
 */
export interface TicketActor {
  id: string;
  role: string;
  region?: Region | null;
}

/**
 * Roles whose replies are recorded as `senderType: 'STAFF'` and carry the
 * author's own `staffId`. AD-T1/AD-C1: an ADMIN or REGIONAL_ADMIN answering
 * from the Interaction Audit is credited to themselves, not to the assigned
 * officer, so the audit trail shows who actually replied.
 */
const STAFF_ROLES = ['OFFICER', 'ADMIN', 'REGIONAL_ADMIN'] as const;

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
        // N-1 - names the distributor this row is ABOUT, so the bell can open
        // their ticket directly. The recipient is `recipientId`, as always.
        subjectCustomerId: customerId,
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

  /**
   * AO-T1 — the officer's ticket list, optionally narrowed to one distributor
   * and/or a set of statuses.
   *
   * Both filters are applied in SQL and therefore counted by `meta.total`, so
   * the Tickets tab inside a distributor detail view and the Open Tickets tile
   * stop narrowing a page in the browser (which made the pager disagree with
   * the rows on screen).
   */
  async getAssignedTickets(
    officerId: string,
    query: {
      page: number;
      pageSize: number;
      customerId?: string;
      status?: TicketStatus[];
    } = { page: 1, pageSize: 20 },
  ) {
    // Tickets for customers this officer manages — primary OR secondary
    // (matches /officers/customers and chat access).
    const portfolio: Prisma.CustomerWhereInput = {
      OR: [
        { assignedOfficerId: officerId },
        { officerAssignments: { some: { staffId: officerId } } },
      ],
    };

    if (query.customerId) {
      // A distributor outside the officer's own book is a bad request, not an
      // empty list — an empty list reads as "no tickets" and hides the mistake.
      const assigned = await this.prisma.customer.findFirst({
        where: { AND: [{ id: query.customerId }, portfolio] },
        select: { id: true },
      });
      if (!assigned) {
        throw new BadRequestException({
          message: 'customerId does not match a distributor assigned to you',
          code: 'VALIDATION_ERROR',
          statusCode: HttpStatus.BAD_REQUEST,
        });
      }
    }

    const where: Prisma.SupportTicketWhereInput = {
      customer: portfolio,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
    };

    const page = await paginate(
      () => this.prisma.supportTicket.count({ where }),
      (skip, take) =>
        this.prisma.supportTicket.findMany({
          where,
          include: {
            // Widened from { name, erpId }: the Tickets tab renders the
            // distributor header from the row it already holds.
            customer: {
              select: {
                id: true,
                erpId: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            _count: { select: { replies: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      { page: query.page, pageSize: query.pageSize },
    );

    return {
      data: page.data.map(({ _count, ...ticket }) => ({
        ...ticket,
        repliesCount: _count.replies,
      })),
      meta: page.meta,
    };
  }

  /**
   * AD-T1 — the full thread, with the authorisation rule for every role that
   * can open one.
   *
   * - CUSTOMER  — only their own ticket.
   * - OFFICER   — only a customer they currently manage (primary or secondary).
   * - ADMIN     — every ticket. The audit is organisation-wide, and an admin is
   *               never the assigned officer, so no assignment check applies.
   * - REGIONAL_ADMIN — every ticket whose customer is in their OWN region;
   *               403 outside it. The region comes from the token, matching
   *               the scoping already applied to GET /admin/audit/chats.
   */
  async getTicket(ticketId: string, user: TicketActor) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: {
          orderBy: { createdAt: 'asc' },
          // S-1 - who wrote each staff reply, so an admin or regional admin
          // stepping in is distinguishable from the assigned officer.
          include: { staff: { select: STAFF_SENDER_SELECT } },
        },
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
    // AD-T1 / RA-T2 — a regional admin never reaches outside their region.
    if (
      user.role === 'REGIONAL_ADMIN' &&
      ticket.customer.region !== (user.region ?? null)
    ) {
      throw new ForbiddenException('Access denied');
    }

    // S-1 - `staff` is null on a customer-authored reply, whose `staffId` is
    // null anyway.
    return { ...ticket, replies: withStaffSenders(ticket.replies) };
  }

  /**
   * AD-T1 — a reply from any participant.
   *
   * Returns the SAME thread shape as `getTicket` with the new reply already
   * appended, so the modal re-renders straight from the response instead of
   * refetching. The created reply is also echoed on `reply` for callers that
   * only need that row.
   *
   * A staff reply is credited to its author's own `staffId` — including an
   * ADMIN or REGIONAL_ADMIN answering from the Interaction Audit — so the
   * trail shows who actually replied rather than the assigned officer.
   */
  async replyToTicket(
    ticketId: string,
    user: TicketActor,
    dto: ReplyTicketDto,
  ) {
    const ticket = await this.getTicket(ticketId, user);
    const isStaff = (STAFF_ROLES as readonly string[]).includes(user.role);

    await this.prisma.ticketReply.create({
      data: {
        ticketId: ticket.id,
        senderType: user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
        customerId: user.role === 'CUSTOMER' ? user.id : null,
        staffId: isStaff ? user.id : null,
        content: dto.content,
        attachmentUrl: dto.attachmentUrl,
      },
    });

    // PRD §6 - staff reply pushes the customer (US-11.7); a customer reply
    // notifies every officer currently on the account.
    if (user.role === 'CUSTOMER') {
      for (const staffId of await this.currentOfficerIds(ticket.customerId)) {
        await this.notifications.notify({
          recipientType: 'STAFF',
          recipientId: staffId,
          subjectCustomerId: ticket.customerId,
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

    // Re-read rather than splicing locally: `updatedAt` moves and the reply
    // ordering has to be the one the next GET would return.
    const thread = await this.getTicket(ticketId, user);
    return { ...thread, reply: thread.replies[thread.replies.length - 1] };
  }

  /**
   * AD-T1 — status change. Authorised through `getTicket` with the CALLER's
   * own role, so an ADMIN is not held to the officer assignment check (which
   * would answer 403 for every ticket in the audit) and a REGIONAL_ADMIN
   * stays inside their region.
   */
  async updateStatus(
    ticketId: string,
    user: TicketActor,
    dto: UpdateTicketStatusDto,
  ) {
    const ticket = await this.getTicket(ticketId, user);

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
