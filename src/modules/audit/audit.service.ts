import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { InteractionAuditFilterDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async searchChats(filter: InteractionAuditFilterDto) {
    const dateClause =
      filter.startDate || filter.endDate
        ? {
            createdAt: {
              ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
              ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
            },
          }
        : {};

    return this.prisma.message.findMany({
      where: {
        ...dateClause,
        ...(filter.keyword
          ? { content: { contains: filter.keyword, mode: 'insensitive' } }
          : {}),
        customer: {
          ...(filter.customerName
            ? { name: { contains: filter.customerName, mode: 'insensitive' } }
            : {}),
          ...(filter.region ? { region: filter.region } : {}),
        },
        ...(filter.officerName
          ? {
              staff: {
                name: { contains: filter.officerName, mode: 'insensitive' },
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        customer: { select: { id: true, name: true, region: true } },
        staff: { select: { id: true, name: true } },
      },
    });
  }

  async searchTickets(filter: InteractionAuditFilterDto) {
    const dateClause =
      filter.startDate || filter.endDate
        ? {
            createdAt: {
              ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
              ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
            },
          }
        : {};

    return this.prisma.supportTicket.findMany({
      where: {
        ...dateClause,
        ...(filter.keyword
          ? {
              OR: [
                { subject: { contains: filter.keyword, mode: 'insensitive' } },
                {
                  description: {
                    contains: filter.keyword,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
        customer: {
          ...(filter.customerName
            ? { name: { contains: filter.customerName, mode: 'insensitive' } }
            : {}),
          ...(filter.region ? { region: filter.region } : {}),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        customer: { select: { id: true, name: true, region: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            staff: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async exportTicketsCsv(filter: InteractionAuditFilterDto): Promise<string> {
    const tickets = await this.searchTickets(filter);
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
