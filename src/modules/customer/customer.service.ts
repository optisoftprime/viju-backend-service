import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  UpdateProfilePhotoDto,
  ChangePasswordDto,
  PurchaseFilterDto,
} from './dto/customer.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
        updatedAt: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer profile not found');

    // PRD F2: Stock Balance = goods paid for but not yet fully loaded.
    // Derive from purchases that are not yet fully covered by completed
    // loading requests.
    const purchases = await this.prisma.purchase.findMany({
      where: { customerId },
      select: {
        id: true,
        items: { select: { quantity: true } },
        loadingRequests: {
          where: { status: 'COMPLETED' },
          select: { quantityCartons: true },
        },
      },
    });
    const stockBalanceCartons = purchases.reduce((sum, p) => {
      const paidQty = p.items.reduce((a, i) => a + i.quantity, 0);
      const loadedQty = p.loadingRequests.reduce(
        (a, r) => a + (r.quantityCartons ?? 0),
        0,
      );
      return sum + Math.max(0, paidQty - loadedQty);
    }, 0);

    const recentPurchases = await this.prisma.purchase.findMany({
      where: { customerId },
      orderBy: { orderDate: 'desc' },
      take: 5,
      select: {
        id: true,
        erpId: true,
        orderDate: true,
        totalItems: true,
        totalValue: true,
        status: true,
      },
    });

    const productFlyers = await this.prisma.productFlyer.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, imageUrl: true, name: true },
    });

    return {
      accountBalance: {
        amount: customer.outstandingBalance,
        lastUpdated: customer.updatedAt,
        isLow: customer.outstandingBalance < 0,
      },
      stockBalance: {
        totalCartons: stockBalanceCartons,
        lastUpdated: customer.updatedAt,
      },
      productFlyers,
      recentPurchases,
    };
  }

  async getStockBalanceBreakdown(customerId: string) {
    const purchases = await this.prisma.purchase.findMany({
      where: { customerId },
      select: {
        id: true,
        erpId: true,
        items: {
          select: { productName: true, quantity: true },
        },
        loadingRequests: {
          where: { status: { in: ['COMPLETED', 'LOADING_IN_PROGRESS'] } },
          select: { quantityCartons: true, status: true },
        },
      },
    });

    const productMap = new Map<
      string,
      { productName: string; paid: number; loaded: number; remaining: number }
    >();

    for (const p of purchases) {
      for (const item of p.items) {
        const existing = productMap.get(item.productName) ?? {
          productName: item.productName,
          paid: 0,
          loaded: 0,
          remaining: 0,
        };
        existing.paid += item.quantity;
        productMap.set(item.productName, existing);
      }
      const loadedFromCompleted = p.loadingRequests
        .filter((r) => r.status === 'COMPLETED')
        .reduce((sum, r) => sum + (r.quantityCartons ?? 0), 0);
      // Apportion completed loading qty across products in this purchase
      // proportionally (mocks the per-product loaded ratio until ERP wires it).
      const totalItemQty = p.items.reduce((a, i) => a + i.quantity, 0);
      if (totalItemQty > 0 && loadedFromCompleted > 0) {
        for (const item of p.items) {
          const share = Math.round(
            (item.quantity / totalItemQty) * loadedFromCompleted,
          );
          const ex = productMap.get(item.productName);
          if (ex) ex.loaded += share;
        }
      }
    }

    const breakdown = Array.from(productMap.values()).map((row) => ({
      productName: row.productName,
      quantityPaid: row.paid,
      quantityLoaded: row.loaded,
      quantityRemaining: Math.max(0, row.paid - row.loaded),
    }));

    return {
      totalRemainingCartons: breakdown.reduce(
        (a, r) => a + r.quantityRemaining,
        0,
      ),
      products: breakdown,
    };
  }

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        erpId: true,
        name: true,
        phone: true,
        accountStatus: true,
        outstandingBalance: true,
        profilePhotoUrl: true,
        assignedOfficer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer;
  }

  async updatePhoto(customerId: string, dto: UpdateProfilePhotoDto) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { profilePhotoUrl: dto.photoUrl },
    });
  }

  async changePassword(customerId: string, dto: ChangePasswordDto) {
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { password: hashedPassword },
    });
  }

  async getPurchases(customerId: string, filter: PurchaseFilterDto) {
    const where: any = { customerId };

    if (filter.search) {
      where.OR = [
        { erpId: { contains: filter.search, mode: 'insensitive' } },
        {
          items: {
            some: {
              productName: { contains: filter.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    if (filter.startDate || filter.endDate) {
      where.orderDate = {};
      if (filter.startDate) where.orderDate.gte = new Date(filter.startDate);
      if (filter.endDate) where.orderDate.lte = new Date(filter.endDate);
    }

    return this.prisma.purchase.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      include: { items: true },
    });
  }

  async getPayments(customerId: string) {
    return this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { date: 'desc' },
    });
  }
}
