import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  SyncBalanceDto,
  SyncPurchaseDto,
  SyncPaymentDto,
  SyncStockDto,
} from './dto/erp.dto';
import { orderStatusFromErp } from './order-status';

@Injectable()
export class ErpService {
  constructor(private readonly prisma: PrismaService) {}

  async syncBalance(dto: SyncBalanceDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { erpId: dto.erpId },
    });
    if (!customer)
      throw new NotFoundException(
        `Customer with ERP ID ${dto.erpId} not found`,
      );

    return this.prisma.customer.update({
      where: { id: customer.id },
      data: { outstandingBalance: dto.outstandingBalance },
    });
  }

  async syncStock(dto: SyncStockDto) {
    return this.prisma.stock.upsert({
      where: { erpId: dto.erpId },
      update: {
        productName: dto.productName,
        quantity: dto.quantity,
      },
      create: {
        erpId: dto.erpId,
        productName: dto.productName,
        quantity: dto.quantity,
      },
    });
  }

  async syncPurchase(dto: SyncPurchaseDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { erpId: dto.customerErpId },
    });
    if (!customer)
      throw new NotFoundException(
        `Customer with ERP ID ${dto.customerErpId} not found`,
      );

    return this.prisma.$transaction(async (prisma) => {
      // Upsert Purchase
      // B-5.3 — map the ERP state through the published table instead of
      // storing whatever arrived (which defaulted everything to PROCESSING).
      const status = orderStatusFromErp(dto.status);
      const existing = await prisma.purchase.findUnique({
        where: { erpId: dto.erpId },
        select: { status: true },
      });
      // Only move the stamp when the status actually changes, so it means
      // "when this order last changed state", not "when it was last synced".
      const statusUpdatedAt =
        existing && existing.status === status ? undefined : new Date();

      const purchase = await prisma.purchase.upsert({
        where: { erpId: dto.erpId },
        update: {
          status,
          ...(statusUpdatedAt ? { statusUpdatedAt } : {}),
          totalItems: dto.totalItems,
          totalValue: dto.totalValue,
        },
        create: {
          erpId: dto.erpId,
          customerId: customer.id,
          orderDate: new Date(dto.orderDate),
          status,
          statusUpdatedAt: new Date(),
          totalItems: dto.totalItems,
          totalValue: dto.totalValue,
        },
      });

      // Clear existing items and recreate
      await prisma.purchaseItem.deleteMany({
        where: { purchaseId: purchase.id },
      });
      await prisma.purchaseItem.createMany({
        data: dto.items.map((i) => ({
          purchaseId: purchase.id,
          productName: i.productName,
          itemCode: i.itemCode ?? null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
      });

      return purchase;
    });
  }

  async syncPayment(dto: SyncPaymentDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { erpId: dto.customerErpId },
    });
    if (!customer)
      throw new NotFoundException(
        `Customer with ERP ID ${dto.customerErpId} not found`,
      );

    return this.prisma.payment.upsert({
      where: { erpId: dto.erpId },
      update: {
        amount: dto.amount,
        runningBalance: dto.runningBalance,
      },
      create: {
        erpId: dto.erpId,
        customerId: customer.id,
        date: new Date(dto.date),
        amount: dto.amount,
        reference: dto.reference,
        runningBalance: dto.runningBalance,
      },
    });
  }
}
