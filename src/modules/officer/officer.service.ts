import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate } from '../../common/pagination/paginate';

export type StockStatus = 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK';

// Below this carton count a product reads as Low Stock (0 = Out of Stock).
const LOW_STOCK_THRESHOLD = 500;

function stockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  if (quantity <= LOW_STOCK_THRESHOLD) return 'LOW_STOCK';
  return 'AVAILABLE';
}

@Injectable()
export class OfficerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD F9: Officer dashboard summary cards.
   * Total distributors, overdue balances, open tickets, unread messages.
   */
  async getDashboardSummary(officerId: string) {
    const customers = await this.prisma.customer.findMany({
      where: { assignedOfficerId: officerId },
      select: { id: true, outstandingBalance: true },
    });
    const customerIds = customers.map((c) => c.id);
    const overdueCount = customers.filter(
      (c) => c.outstandingBalance < 0,
    ).length;

    const [openTickets, unreadMessages] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { customerId: { in: customerIds }, status: 'OPEN' },
      }),
      this.prisma.message.count({
        where: {
          customerId: { in: customerIds },
          senderType: 'CUSTOMER',
          readAt: null,
        },
      }),
    ]);

    return {
      totalDistributors: customers.length,
      overdueBalances: overdueCount,
      openTickets,
      unreadMessages,
    };
  }

  async getAssignedCustomers(
    user: { id: string; role: string },
    query: {
      page: number;
      pageSize: number;
      search?: string;
      overdue?: boolean;
      activeTickets?: boolean;
    } = { page: 1, pageSize: 20 },
  ) {
    const pagination = { page: query.page, pageSize: query.pageSize };

    // Admin sees every customer org-wide (PRD F14). Officers see only
    // customers where they are primary OR secondary assigned (PRD F6).
    const roleScope: Prisma.CustomerWhereInput =
      user.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { assignedOfficerId: user.id },
              { officerAssignments: { some: { staffId: user.id } } },
            ],
          };

    // Combine role scope with the optional filters via AND, so search can use
    // its own OR without clobbering the assignment OR above.
    const and: Prisma.CustomerWhereInput[] = [roleScope];

    if (query.search?.trim()) {
      const term = query.search.trim();
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { erpId: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    // Overdue = negative balance (matches the dashboard's overdue definition).
    if (query.overdue) {
      and.push({ outstandingBalance: { lt: 0 } });
    }

    // Active tickets = has at least one OPEN support ticket.
    if (query.activeTickets) {
      and.push({ supportTickets: { some: { status: 'OPEN' } } });
    }

    const where: Prisma.CustomerWhereInput = { AND: and };

    const page = await paginate(
      () => this.prisma.customer.count({ where }),
      (skip, take) =>
        this.prisma.customer.findMany({
          where,
          select: {
            id: true,
            name: true,
            erpId: true,
            phone: true,
            region: true,
            outstandingBalance: true,
            accountStatus: true,
            updatedAt: true,
            _count: {
              select: { supportTickets: { where: { status: 'OPEN' } } },
            },
          },
          orderBy: { name: 'asc' },
          skip,
          take,
        }),
      pagination,
    );

    // Last purchase date + last contact (message) — only for the page slice
    const customerIds = page.data.map((c) => c.id);
    const [lastPurchases, lastMessages] = await Promise.all([
      this.prisma.purchase.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { orderDate: true },
      }),
      this.prisma.message.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { createdAt: true },
      }),
    ]);
    const lastPurchaseMap = new Map(
      lastPurchases.map((r) => [r.customerId, r._max.orderDate]),
    );
    const lastMessageMap = new Map(
      lastMessages.map((r) => [r.customerId, r._max.createdAt]),
    );

    return {
      data: page.data.map((c) => ({
        id: c.id,
        name: c.name,
        accountNumber: c.erpId,
        phone: c.phone,
        region: c.region,
        walletBalance: c.outstandingBalance,
        accountStatus: c.accountStatus,
        openTickets: c._count.supportTickets,
        lastPurchaseDate: lastPurchaseMap.get(c.id) ?? null,
        lastContactDate: lastMessageMap.get(c.id) ?? c.updatedAt,
      })),
      meta: page.meta,
    };
  }

  /**
   * PRD F10: Distributor account detail page.
   * Returns Overview tab content; other tabs (Orders, Invoices, etc.) are
   * served by dedicated endpoints below for pagination/lazy-load support.
   */
  async getCustomerOverview(officerId: string, customerId: string) {
    const customer = await this.ensureAssignedCustomer(officerId, customerId);
    const assignments = await this.prisma.customerOfficer.findMany({
      where: { customerId },
      include: {
        staff: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    return {
      id: customer.id,
      name: customer.name,
      accountNumber: customer.erpId,
      phone: customer.phone,
      email: customer.email,
      region: customer.region,
      accountStatus: customer.accountStatus,
      walletBalance: customer.outstandingBalance,
      assignedOfficers: assignments.map((a) => ({
        ...a.staff,
        isPrimary: a.isPrimary,
      })),
      lastUpdated: customer.updatedAt,
    };
  }

  async getCustomerOrders(
    officerId: string,
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    await this.ensureAssignedCustomer(officerId, customerId);
    const where = { customerId };
    return paginate(
      () => this.prisma.purchase.count({ where }),
      (skip, take) =>
        this.prisma.purchase.findMany({
          where,
          orderBy: { orderDate: 'desc' },
          include: { items: true },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getCustomerInvoices(officerId: string, customerId: string) {
    await this.ensureAssignedCustomer(officerId, customerId);
    const [customer, purchases, payments] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { outstandingBalance: true },
      }),
      this.prisma.purchase.findMany({
        where: { customerId },
        orderBy: { orderDate: 'desc' },
        include: { items: true },
      }),
      this.prisma.payment.findMany({
        where: { customerId },
        orderBy: { date: 'desc' },
      }),
    ]);
    return {
      walletBalance: customer?.outstandingBalance ?? 0,
      invoices: purchases,
      paymentHistory: payments,
    };
  }

  async getCustomerStock(officerId: string, customerId: string) {
    await this.ensureAssignedCustomer(officerId, customerId);
    // PRD F10 AC6: current stock from ERP + stock balance awaiting loading.
    const purchases = await this.prisma.purchase.findMany({
      where: { customerId },
      select: {
        items: { select: { productName: true, quantity: true } },
        loadingRequests: {
          where: { status: 'COMPLETED' },
          select: { quantityCartons: true },
        },
      },
    });
    const productMap = new Map<
      string,
      { productName: string; reserved: number; loaded: number }
    >();
    for (const p of purchases) {
      const totalQty = p.items.reduce((a, i) => a + i.quantity, 0);
      const loaded = p.loadingRequests.reduce(
        (a, r) => a + (r.quantityCartons ?? 0),
        0,
      );
      for (const item of p.items) {
        const existing = productMap.get(item.productName) ?? {
          productName: item.productName,
          reserved: 0,
          loaded: 0,
        };
        existing.reserved += item.quantity;
        const share =
          totalQty > 0 ? Math.round((item.quantity / totalQty) * loaded) : 0;
        existing.loaded += share;
        productMap.set(item.productName, existing);
      }
    }
    const stockCatalogue = await this.prisma.stock.findMany({
      orderBy: { productName: 'asc' },
    });
    // One row per product, shaped for the Figma Stock tab columns:
    // Product | Stock Balance | Reserved Stock | Awaiting Loading | Last Stock Update | Status
    return {
      catalogue: stockCatalogue.map((s) => {
        const m = productMap.get(s.productName);
        const reserved = m?.reserved ?? 0;
        const loaded = m?.loaded ?? 0;
        return {
          id: s.id,
          erpId: s.erpId,
          productName: s.productName,
          stockBalance: s.quantity,
          reservedStock: reserved,
          loaded,
          awaitingLoading: Math.max(0, reserved - loaded),
          lastStockUpdate: s.updatedAt,
          status: stockStatus(s.quantity),
        };
      }),
    };
  }

  async getCustomerWaybills(
    officerId: string,
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    await this.ensureAssignedCustomer(officerId, customerId);
    const where = { customerId };
    return paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            assignedOfficer: { select: { id: true, name: true } },
            linkedPurchase: { select: { erpId: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  private async ensureAssignedCustomer(officerId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        OR: [
          { assignedOfficerId: officerId },
          { officerAssignments: { some: { staffId: officerId } } },
        ],
      },
      // Never surface auth secrets: getCustomerDetail spreads this record
      // straight into its response.
      omit: { password: true, failedLoginAttempts: true, lockedUntil: true },
    });
    if (!customer)
      throw new NotFoundException('Customer not found or not assigned to you');
    return customer;
  }

  async getCustomerDetail(officerId: string, customerId: string) {
    // Legacy compatibility - returns overview + all transactional data
    const customer = await this.ensureAssignedCustomer(officerId, customerId);
    const [purchases, payments, supportTickets] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { customerId },
        orderBy: { orderDate: 'desc' },
        include: { items: true },
      }),
      this.prisma.payment.findMany({
        where: { customerId },
        orderBy: { date: 'desc' },
      }),
      this.prisma.supportTicket.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { ...customer, purchases, payments, supportTickets };
  }

  async getStock(
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    return paginate(
      () => this.prisma.stock.count(),
      async (skip, take) => {
        const rows = await this.prisma.stock.findMany({
          orderBy: { productName: 'asc' },
          skip,
          take,
        });
        // General ERP stock has no customer context, so no reserved/awaiting —
        // but include the derived status to match the Figma stock columns.
        return rows.map((s) => ({
          id: s.id,
          erpId: s.erpId,
          productName: s.productName,
          stockBalance: s.quantity,
          lastStockUpdate: s.updatedAt,
          status: stockStatus(s.quantity),
        }));
      },
      pagination,
    );
  }
}
