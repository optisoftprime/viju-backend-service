import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate, paginateInMemory } from '../../common/pagination/paginate';
import {
  SortOrder,
  compareBy,
  sortDirection,
} from '../../common/pagination/sort.dto';
import { AssignedCustomerSortField } from './dto/officer-request.dto';

/**
 * The caller of every officer-portal route. ADMIN is included deliberately:
 * US-12.3 lets an administrator open ANY distributor and see the same tabs as
 * the officer, so the role travels with the id and the assignment check is
 * skipped for ADMIN only.
 */
export interface OfficerPortalUser {
  id: string;
  role: string;
}

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
    user: OfficerPortalUser,
    query: {
      page: number;
      pageSize: number;
      search?: string;
      overdue?: boolean;
      activeTickets?: boolean;
      sortBy?: AssignedCustomerSortField;
      sortOrder?: SortOrder;
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

    // lastPurchaseDate, lastContactDate and openTickets are all derived after
    // the query (aggregates and a filtered relation count), so sorting on one
    // of them cannot be pushed into SQL without changing what the column
    // means. Those three sort the full matching set in memory; the rest sort
    // in the database and only derive values for the page slice.
    const derivedSort =
      query.sortBy === 'lastPurchaseDate' ||
      query.sortBy === 'lastContactDate' ||
      query.sortBy === 'openTickets';

    if (derivedSort) {
      const rows = await this.prisma.customer.findMany({
        where,
        select: this.assignedCustomerSelect,
        orderBy: { name: 'asc' },
      });
      const mapped = await this.withDerivedColumns(rows);
      const order = sortDirection(query.sortOrder);
      mapped.sort(
        compareBy(
          query.sortBy === 'openTickets'
            ? (c) => c.openTickets
            : query.sortBy === 'lastPurchaseDate'
              ? (c) => c.lastPurchaseDate
              : (c) => c.lastContactDate,
          order,
        ),
      );
      return paginateInMemory(mapped, pagination);
    }

    const page = await paginate(
      () => this.prisma.customer.count({ where }),
      (skip, take) =>
        this.prisma.customer.findMany({
          where,
          select: this.assignedCustomerSelect,
          orderBy: this.assignedCustomerOrderBy(query.sortBy, query.sortOrder),
          skip,
          take,
        }),
      pagination,
    );

    return {
      data: await this.withDerivedColumns(page.data),
      meta: page.meta,
    };
  }

  private readonly assignedCustomerSelect = {
    id: true,
    name: true,
    erpId: true,
    phone: true,
    region: true,
    outstandingBalance: true,
    accountStatus: true,
    updatedAt: true,
    _count: {
      select: { supportTickets: { where: { status: 'OPEN' as const } } },
    },
  };

  /** Columns of GET /officers/customers that map onto a Prisma orderBy. */
  private assignedCustomerOrderBy(
    sortBy: AssignedCustomerSortField | undefined,
    sortOrder?: SortOrder,
  ): Prisma.CustomerOrderByWithRelationInput {
    // Default (no sortBy) reproduces today's ordering exactly (US-09.3).
    if (!sortBy) return { name: 'asc' };
    const direction = sortDirection(sortOrder);
    switch (sortBy) {
      case 'name':
        return { name: direction };
      case 'accountNumber':
        return { erpId: direction };
      case 'walletBalance':
        return { outstandingBalance: direction };
      default:
        return { name: 'asc' };
    }
  }

  /**
   * Adds last purchase date + last contact date to a set of customer rows.
   * Two grouped queries regardless of how many rows are passed in.
   */
  private async withDerivedColumns(
    rows: {
      id: string;
      name: string;
      erpId: string;
      phone: string;
      region: string;
      outstandingBalance: number;
      accountStatus: string;
      updatedAt: Date;
      _count: { supportTickets: number };
    }[],
  ) {
    const customerIds = rows.map((c) => c.id);
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

    return rows.map((c) => ({
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
    }));
  }

  /**
   * PRD F10: Distributor account detail page.
   * Returns Overview tab content; other tabs (Orders, Invoices, etc.) are
   * served by dedicated endpoints below for pagination/lazy-load support.
   */
  async getCustomerOverview(user: OfficerPortalUser, customerId: string) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
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
    user: OfficerPortalUser,
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
    const where = { customerId };
    const [page, lastSync] = await Promise.all([
      paginate(
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
      ),
      this.prisma.purchase.aggregate({
        where,
        _max: { updatedAt: true },
      }),
    ]);
    // PRD §7 / US-10.7: when the ERP data for this dataset was last synced —
    // NOT the time of this request.
    return {
      lastUpdated: lastSync._max.updatedAt ?? customer.updatedAt,
      ...page,
    };
  }

  async getCustomerInvoices(user: OfficerPortalUser, customerId: string) {
    const scoped = await this.ensureAssignedCustomer(user, customerId);
    const [customer, purchases, payments] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { outstandingBalance: true, updatedAt: true },
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
    // Invoices are assembled from three ERP-fed sources; the stamp is the
    // most recent of them (US-10.7). The balance itself lands on Customer,
    // so its updatedAt counts too.
    return {
      lastUpdated: this.latestDate([
        customer?.updatedAt ?? scoped.updatedAt,
        ...purchases.map((p) => p.updatedAt),
        ...payments.map((p) => p.createdAt),
      ]),
      walletBalance: customer?.outstandingBalance ?? 0,
      invoices: purchases,
      paymentHistory: payments,
    };
  }

  async getCustomerStock(user: OfficerPortalUser, customerId: string) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
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
      // US-10.7 — last ERP stock sync, from the Stock rows themselves.
      lastUpdated: this.latestDate([
        customer.updatedAt,
        ...stockCatalogue.map((s) => s.updatedAt),
      ]),
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
    user: OfficerPortalUser,
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
    const where = { customerId };
    const [page, lastSync] = await Promise.all([
      paginate(
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
      ),
      this.prisma.loadingRequest.aggregate({
        where,
        _max: { updatedAt: true },
      }),
    ]);
    return {
      lastUpdated: lastSync._max.updatedAt ?? customer.updatedAt,
      ...page,
    };
  }

  /** Most recent of a list of dates, ignoring nulls. */
  private latestDate(dates: (Date | null | undefined)[]): Date {
    const times = dates
      .filter((d): d is Date => d instanceof Date)
      .map((d) => d.getTime());
    return new Date(times.length ? Math.max(...times) : Date.now());
  }

  /**
   * Resolves the customer for a per-tab route, enforcing scope.
   *
   * OFFICER: only customers they are assigned to, primary or secondary.
   * ADMIN:   any customer (US-12.3) — the administrator opens the same five
   *          tabs with byte-identical responses, so the assignment filter is
   *          skipped rather than the routes being mirrored under /admin.
   */
  private async ensureAssignedCustomer(
    user: OfficerPortalUser,
    customerId: string,
  ) {
    const isAdmin = user.role === 'ADMIN';
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { assignedOfficerId: user.id },
                { officerAssignments: { some: { staffId: user.id } } },
              ],
            }),
      },
      // Never surface auth secrets: getCustomerDetail spreads this record
      // straight into its response.
      omit: { password: true, failedLoginAttempts: true, lockedUntil: true },
    });
    if (!customer)
      throw new NotFoundException(
        isAdmin
          ? 'Customer not found'
          : 'Customer not found or not assigned to you',
      );
    return customer;
  }

  async getCustomerDetail(user: OfficerPortalUser, customerId: string) {
    // Legacy compatibility - returns overview + all transactional data
    const customer = await this.ensureAssignedCustomer(user, customerId);
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
