import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { InteractionAuditFilterDto } from './dto/audit.dto';
import { paginate } from '../../common/pagination/paginate';

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

  async searchChats(
    filter: InteractionAuditFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = this.buildChatWhere(filter);
    return paginate(
      () => this.prisma.message.count({ where }),
      (skip, take) =>
        this.prisma.message.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true, region: true } },
            staff: { select: { id: true, name: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
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
          orderBy: { createdAt: 'desc' },
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
