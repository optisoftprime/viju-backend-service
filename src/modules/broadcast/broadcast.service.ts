import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { paginate } from '../../common/pagination/paginate';
import {
  SendRegionalBroadcastDto,
  SendIndividualBroadcastDto,
  BroadcastHistoryFilterDto,
} from './dto/broadcast.dto';

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async sendRegional(adminId: string, dto: SendRegionalBroadcastDto) {
    const customers = await this.prisma.customer.findMany({
      where: { region: { in: dto.regions } },
      select: { id: true },
    });

    const reference = `BR-${Date.now().toString().slice(-6)}-Regional`;
    const broadcast = await this.prisma.broadcast.create({
      data: {
        reference,
        type: 'REGIONAL',
        message: dto.message,
        targetRegions: dto.regions,
        sentById: adminId,
        deliveredCount: customers.length,
      },
    });

    for (const c of customers) {
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: c.id,
        title: 'Viju',
        body: dto.message,
        type: 'BROADCAST_REGIONAL',
        data: { broadcastId: broadcast.id },
      });
    }

    return broadcast;
  }

  async sendIndividual(adminId: string, dto: SendIndividualBroadcastDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
        region: true,
      },
    });
    if (!customer) throw new NotFoundException('Distributor not found');

    let allowancePaymentId: string | undefined;

    // PRD F15 AC5 + §8: delivery allowance reflects in wallet IMMEDIATELY,
    // not at next ERP sync. Write the Payment + bump Customer.outstandingBalance
    // in a single transaction.
    if (dto.deliveryAllowance && dto.deliveryAllowance > 0) {
      const allowance = dto.deliveryAllowance;
      const newBalance = customer.outstandingBalance + allowance;
      const result = await this.prisma.$transaction([
        this.prisma.customer.update({
          where: { id: customer.id },
          data: { outstandingBalance: newBalance },
        }),
        this.prisma.payment.create({
          data: {
            customerId: customer.id,
            date: new Date(),
            amount: allowance,
            reference: 'Delivery Allowance',
            runningBalance: newBalance,
          },
        }),
      ]);
      allowancePaymentId = result[1].id;
    }

    const reference = `BR-${Date.now().toString().slice(-6)}-Individual`;
    const broadcast = await this.prisma.broadcast.create({
      data: {
        reference,
        type: 'INDIVIDUAL',
        message: dto.message,
        targetRegions: [customer.region],
        targetCustomerId: customer.id,
        deliveryAllowance: dto.deliveryAllowance ?? null,
        allowancePaymentId,
        sentById: adminId,
        deliveredCount: 1,
      },
    });

    // PRD F15 AC4 — individual notification carries distributor name +
    // allowance amount.
    const body = dto.deliveryAllowance
      ? `${customer.name}: ${dto.message}. Delivery allowance of ₦${dto.deliveryAllowance.toLocaleString(
          'en-NG',
        )} has been credited to your wallet.`
      : `${customer.name}: ${dto.message}`;
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: customer.id,
      title: 'Viju',
      body,
      type: dto.deliveryAllowance
        ? 'BROADCAST_INDIVIDUAL_WITH_ALLOWANCE'
        : 'BROADCAST_INDIVIDUAL',
      data: { broadcastId: broadcast.id },
    });

    return broadcast;
  }

  async listHistory(
    filter: BroadcastHistoryFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.region ? { targetRegions: { has: filter.region } } : {}),
      ...(filter.startDate || filter.endDate
        ? {
            sentAt: {
              ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
              ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
            },
          }
        : {}),
    };
    return paginate(
      () => this.prisma.broadcast.count({ where }),
      (skip, take) =>
        this.prisma.broadcast.findMany({
          where,
          orderBy: { sentAt: 'desc' },
          include: {
            sentBy: { select: { name: true, email: true } },
            targetCustomer: { select: { id: true, name: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getDetail(id: string) {
    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id },
      include: {
        sentBy: { select: { name: true, email: true } },
        targetCustomer: { select: { id: true, name: true } },
        allowancePayment: true,
      },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return broadcast;
  }
}
