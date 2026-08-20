import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  InteractionAuditFilterDto,
  TicketAuditSortField,
} from './dto/audit.dto';
import { paginate, paginateInMemory } from '../../common/pagination/paginate';
import { SortOrder, sortDirection } from '../../common/pagination/sort.dto';

/**
 * Most recent messages returned per chat thread. A thread is unbounded, and
 * the audit table only ever renders a preview, so the payload is capped and
 * `messageCount` reports the true total.
 */
const MAX_MESSAGES_PER_THREAD = 200;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private buildDateClause(filter: InteractionAuditFilterDto) {
    return filter.startDate || filter.endDate
      ? {
          createdAt: {
            ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
            ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
          },
        }
      : {};
  }

  private buildChatWhere(filter: InteractionAuditFilterDto) {
    return {
      ...this.buildDateClause(filter),
      ...(filter.keyword
        ? {
            content: {
              contains: filter.keyword,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      customer: {
        ...(filter.customerName
          ? {
              name: {
                contains: filter.customerName,
                mode: 'insensitive' as const,
              },
            }
          : {}),
        ...(filter.region ? { region: filter.region } : {}),
      },
      ...(filter.officerName
        ? {
            staff: {
              name: {
                contains: filter.officerName,
                mode: 'insensitive' as const,
              },
            },
          }
        : {}),
    };
  }

  private buildTicketWhere(filter: InteractionAuditFilterDto) {
    return {
      ...this.buildDateClause(filter),
      ...(filter.keyword
        ? {
            OR: [
              {
                subject: {
                  contains: filter.keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                description: {
                  contains: filter.keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      customer: {
        ...(filter.customerName
          ? {
              name: {
                contains: filter.customerName,
                mode: 'insensitive' as const,
              },
            }
          : {}),
        ...(filter.region ? { region: filter.region } : {}),
      },
    };
  }

  /**
   * US-14.2 — chat audit, grouped into threads.
   *
   * One row per customer/officer conversation, mirroring the ticket audit's
   * filters and envelope so the audits page can render it with the same
   * table, filters and pagination. Strictly read-only (US-14.3): this module
   * exposes no write route at all.
   *
   * Grouping happens in SQL (groupBy customer+officer); the page slice is
   * then hydrated with the participants and a capped message preview.
   */
  async searchChats(
    filter: InteractionAuditFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = this.buildChatWhere(filter);

    const threads = await this.prisma.message.groupBy({
      by: ['customerId', 'staffId'],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
    });

    // Most recently active thread first — the order the audits table opens in.
    threads.sort(
      (a, b) =>
        (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0),
    );

    const page = paginateInMemory(threads, pagination);
    if (page.data.length === 0) return { data: [], meta: page.meta };

    const customerIds = [...new Set(page.data.map((t) => t.customerId))];
    const staffIds = [...new Set(page.data.map((t) => t.staffId))];

    const [customers, officers, messages] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, name: true, region: true },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true },
      }),
      this.prisma.message.findMany({
        where: {
          AND: [
            where,
            { customerId: { in: customerIds }, staffId: { in: staffIds } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          customerId: true,
          staffId: true,
          senderType: true,
          content: true,
          attachmentUrl: true,
          createdAt: true,
        },
      }),
    ]);

    const customerById = new Map(customers.map((c) => [c.id, c]));
    const officerById = new Map(officers.map((o) => [o.id, o]));
    const messagesByThread = new Map<string, typeof messages>();
    for (const m of messages) {
      const key = this.threadKey(m.customerId, m.staffId);
      const bucket = messagesByThread.get(key) ?? [];
      bucket.push(m);
      messagesByThread.set(key, bucket);
    }

    return {
      data: page.data.map((t) => {
        const key = this.threadKey(t.customerId, t.staffId);
        const thread = messagesByThread.get(key) ?? [];
        return {
          id: key,
          customer: customerById.get(t.customerId) ?? null,
          officer: officerById.get(t.staffId) ?? null,
          messageCount: t._count._all,
          lastMessageAt: t._max.createdAt,
          messages: thread
            .slice(-MAX_MESSAGES_PER_THREAD)
            .map(({ customerId: _c, staffId: _s, ...m }) => m),
        };
      }),
      meta: page.meta,
    };
  }

  /** Stable, URL-safe identifier for a customer/officer conversation. */
  private threadKey(customerId: string, staffId: string): string {
    return `${customerId}:${staffId}`;
  }

  /**
   * US-14.2 — CSV of the chat audit, one row per thread, mirroring the
   * ticket export.
   */
  async exportChatsCsv(filter: InteractionAuditFilterDto): Promise<string> {
    const where = this.buildChatWhere(filter);
    const threads = await this.prisma.message.groupBy({
      by: ['customerId', 'staffId'],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
    });
    threads.sort(
      (a, b) =>
        (b._max.createdAt?.getTime() ?? 0) - (a._max.createdAt?.getTime() ?? 0),
    );

    const [customers, officers] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: threads.map((t) => t.customerId) } },
        select: { id: true, name: true, region: true },
      }),
      this.prisma.staff.findMany({
        where: { id: { in: threads.map((t) => t.staffId) } },
        select: { id: true, name: true },
      }),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const officerById = new Map(officers.map((o) => [o.id, o]));

    const header = [
      'threadId',
      'distributorName',
      'region',
      'officerName',
      'messageCount',
      'lastMessageAt',
    ].join(',');
    const lines = threads.map((t) => {
      const customer = customerById.get(t.customerId);
      const officer = officerById.get(t.staffId);
      return [
        this.threadKey(t.customerId, t.staffId),
        this.csv(customer?.name ?? ''),
        customer?.region ?? '',
        this.csv(officer?.name ?? ''),
        t._count._all,
        t._max.createdAt?.toISOString() ?? '',
      ].join(',');
    });
    return [header, ...lines].join('\n');
  }

  /** Columns of the ticket audit that map onto a Prisma orderBy (US-09.3). */
  private ticketOrderBy(
    sortBy: TicketAuditSortField | undefined,
    sortOrder?: SortOrder,
  ): Prisma.SupportTicketOrderByWithRelationInput {
    // Default (no sortBy) reproduces today's ordering exactly.
    if (!sortBy) return { createdAt: 'desc' };
    const direction = sortDirection(sortOrder);
    switch (sortBy) {
      case 'ticketId':
        return { ticketId: direction };
      case 'subject':
        return { subject: direction };
      case 'status':
        return { status: direction };
      case 'customerName':
        return { customer: { name: direction } };
      case 'region':
        return { customer: { region: direction } };
      default:
        return { createdAt: direction };
    }
  }

  async searchTickets(
    filter: InteractionAuditFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = this.buildTicketWhere(filter);
    return paginate(
      () => this.prisma.supportTicket.count({ where }),
      (skip, take) =>
        this.prisma.supportTicket.findMany({
          where,
          orderBy: this.ticketOrderBy(filter.sortBy, filter.sortOrder),
          include: {
            customer: { select: { id: true, name: true, region: true } },
            replies: {
              orderBy: { createdAt: 'asc' },
              include: {
                staff: { select: { id: true, name: true } },
              },
            },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  async exportTicketsCsv(filter: InteractionAuditFilterDto): Promise<string> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: this.buildTicketWhere(filter),
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, region: true } },
        replies: { select: { id: true } },
      },
    });
    const header = [
      'ticketId',
      'distributorName',
      'region',
      'category',
      'subject',
      'status',
      'createdAt',
      'replyCount',
    ].join(',');
    const lines = tickets.map((t) =>
      [
        t.ticketId,
        this.csv(t.customer.name),
        t.customer.region,
        t.category,
        this.csv(t.subject),
        t.status,
        t.createdAt.toISOString(),
        t.replies.length,
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  private csv(value: string): string {
    if (/[",\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
