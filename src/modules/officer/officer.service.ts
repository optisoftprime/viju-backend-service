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
import { stockBalanceByCustomer } from '../../common/customers/stock-balance';
import { messagePreview } from '../../common/messaging/message-preview';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';

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

/**
 * A message the distributor sent that the officer has not read yet (AO-C1).
 * One definition, used by the dashboard tile, the per-row `unreadMessages`
 * count and the `unreadMessages=true` filter, so the three cannot disagree.
 */
const UNREAD_FROM_CUSTOMER = {
  senderType: 'CUSTOMER',
  readAt: null,
} as const;

@Injectable()
export class OfficerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountBalance: ErpAccountBalanceService,
  ) {}

  /**
   * The account balance to show for a set of customers.
   *
   * Derived live from the ERP customer-credit feed
   * (CREDIT_AMT + CREDIT_AMT1 - CREDIT_PAY, see
   * `src/modules/erp/account-balance.ts`) rather than read from the stored
   * column, which the projector populates from the ERP's raw CREDIT_PAY and so
   * inverts for every customer holding credit.
   *
   * The SAME derivation GET /customers/me uses, so an officer and the
   * distributor they are looking at never see two different numbers. An ERP
   * code with no credit record in the feed falls back to the stored column.
   */
  private async balancesFor(
    rows: { erpId: string; outstandingBalance: number }[],
  ): Promise<Map<string, number>> {
    const derived = await this.accountBalance.getRunningBalances(
      rows.map((r) => r.erpId),
    );
    return new Map(
      rows.map((r) => [r.erpId, derived.get(r.erpId) ?? r.outstandingBalance]),
    );
  }

  /** The same derivation for one customer. */
  private async balanceFor(customer: {
    erpId: string;
    outstandingBalance: number;
  }): Promise<number> {
    return (await this.balancesFor([customer])).get(customer.erpId)!;
  }

  /**
   * The customers one officer manages - primary (assignedOfficerId) OR
   * secondary (CustomerOfficer). The same definition GET /officers/customers,
   * the ticket list and chat access all use, so the dashboard tiles count the
   * rows the list actually shows (AO-C1).
   */
  private portfolioOf(officerId: string): Prisma.CustomerWhereInput {
    return {
      OR: [
        { assignedOfficerId: officerId },
        { officerAssignments: { some: { staffId: officerId } } },
      ],
    };
  }

  /**
   * PRD F9: Officer dashboard summary cards.
   * Total distributors, overdue balances, open tickets, unread messages.
   *
   * AO-C1: every tile counts over the officer's whole portfolio, so clicking
   * one and landing on GET /officers/customers shows exactly the customers the
   * tile counted.
   */
  async getDashboardSummary(officerId: string) {
    const customers = await this.prisma.customer.findMany({
      where: this.portfolioOf(officerId),
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
        where: { customerId: { in: customerIds }, ...UNREAD_FROM_CUSTOMER },
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
      unreadMessages?: boolean;
      sortBy?: AssignedCustomerSortField;
      sortOrder?: SortOrder;
    } = { page: 1, pageSize: 20 },
  ) {
    const pagination = { page: query.page, pageSize: query.pageSize };

    // Admin sees every customer org-wide (PRD F14). Officers see only
    // customers where they are primary OR secondary assigned (PRD F6).
    const roleScope: Prisma.CustomerWhereInput =
      user.role === 'ADMIN' ? {} : this.portfolioOf(user.id);

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

    // AO-C1: "waiting on me" - at least one unread message FROM the
    // distributor. Mirrors activeTickets, and uses the same predicate as the
    // per-row count and the dashboard tile.
    if (query.unreadMessages) {
      and.push({ messages: { some: { ...UNREAD_FROM_CUSTOMER } } });
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
      query.sortBy === 'openTickets' ||
      query.sortBy === 'unreadMessages' ||
      query.sortBy === 'lastMessageAt';

    if (derivedSort) {
      const rows = await this.prisma.customer.findMany({
        where,
        select: this.assignedCustomerSelect,
        orderBy: { name: 'asc' },
      });
      const mapped = await this.withDerivedColumns(rows);
      mapped.sort(
        compareBy(
          this.derivedSortValue(query.sortBy),
          sortDirection(query.sortOrder),
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

  /**
   * Column selector for the sorts that cannot be expressed as a Prisma
   * `orderBy` - aggregates and filtered relation counts derived after the
   * query. Nulls sort last in both directions (see `compareBy`), which keeps
   * "never contacted" and "nothing waiting" at the bottom of the table.
   */
  private derivedSortValue(
    sortBy: AssignedCustomerSortField | undefined,
  ): (row: {
    openTickets: number;
    unreadMessages: number;
    lastMessageAt: Date | null;
    lastPurchaseDate: Date | null;
    lastContactDate: Date;
  }) => number | Date | null {
    switch (sortBy) {
      case 'openTickets':
        return (c) => c.openTickets;
      case 'unreadMessages':
        return (c) => c.unreadMessages;
      case 'lastMessageAt':
        return (c) => c.lastMessageAt;
      case 'lastPurchaseDate':
        return (c) => c.lastPurchaseDate;
      default:
        return (c) => c.lastContactDate;
    }
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
    // CH-2 — the distributor's own profile picture, set from the mobile app
    // via PATCH /customers/me/photo. Surfaced as `avatarUrl`.
    profilePhotoUrl: true,
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
   * Adds the derived columns the officer table triages on. Four aggregates
   * regardless of how many rows are passed in, so the cost does not grow with
   * page size.
   *
   * - `unreadMessages` / `lastMessageAt` (AO-C1) - which distributor is
   *   waiting, and since when. `unreadMessages` counts the same rows as the
   *   dashboard tile, so the two agree by construction.
   * - `stockBalanceCartons` (AO-P2) - the same figure GET /admin/customers
   *   returns, from the same shared helper.
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
      profilePhotoUrl: string | null;
      _count: { supportTickets: number };
    }[],
  ) {
    const customerIds = rows.map((c) => c.id);
    const [
      lastPurchases,
      lastMessages,
      unread,
      stockBalances,
      accountBalances,
      lastMessageRows,
    ] = await Promise.all([
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
      this.prisma.message.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, ...UNREAD_FROM_CUSTOMER },
        _count: { _all: true },
      }),
      stockBalanceByCustomer(this.prisma, customerIds),
      this.balancesFor(rows),
      // CH-1 — the newest message on each thread, either side. `groupBy` above
      // gives the TIMESTAMP but not the row, so the messages themselves are
      // fetched here and reduced to one per customer below. One query for the
      // whole page, not one per row.
      this.lastMessagesFor(customerIds),
    ]);
    const lastPurchaseMap = new Map(
      lastPurchases.map((r) => [r.customerId, r._max.orderDate]),
    );
    const lastMessageMap = new Map(
      lastMessages.map((r) => [r.customerId, r._max.createdAt]),
    );
    const unreadMap = new Map(unread.map((r) => [r.customerId, r._count._all]));

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      accountNumber: c.erpId,
      phone: c.phone,
      region: c.region,
      // Derived from the ERP credit feed, exactly as GET /customers/me does.
      walletBalance: accountBalances.get(c.erpId) ?? c.outstandingBalance,
      stockBalanceCartons: stockBalances.get(c.id) ?? 0,
      accountStatus: c.accountStatus,
      openTickets: c._count.supportTickets,
      // Always a number, never omitted - 0 when nothing is waiting.
      unreadMessages: unreadMap.get(c.id) ?? 0,
      // Null when the distributor has never messaged, unlike lastContactDate
      // which falls back to updatedAt.
      lastMessageAt: lastMessageMap.get(c.id) ?? null,
      // CH-1 — the excerpt and who wrote it, so the row can prefix the
      // officer's own last message with "You: ". Both null on an empty thread.
      lastMessagePreview: messagePreview(lastMessageRows.get(c.id)),
      lastMessageSenderType: lastMessageRows.get(c.id)?.senderType ?? null,
      // CH-2 — the distributor's own picture, or null to keep the client's
      // initials fallback.
      avatarUrl: c.profilePhotoUrl,
      lastPurchaseDate: lastPurchaseMap.get(c.id) ?? null,
      lastContactDate: lastMessageMap.get(c.id) ?? c.updatedAt,
    }));
  }

  /**
   * CH-1 — the newest message on each of these threads, keyed by customer.
   *
   * `DISTINCT ON` picks one row per customer in a single pass, which is what
   * keeps this one query rather than one per conversation. Ordered by
   * `createdAt` then `id`, so two messages sharing a timestamp still resolve
   * to the same one every time rather than flickering between renders.
   */
  private async lastMessagesFor(customerIds: string[]): Promise<
    Map<
      string,
      {
        content: string | null;
        attachmentUrl: string | null;
        senderType: string;
      }
    >
  > {
    if (customerIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      {
        customerId: string;
        content: string | null;
        attachmentUrl: string | null;
        senderType: string;
      }[]
    >`
      SELECT DISTINCT ON ("customerId")
             "customerId", "content", "attachmentUrl", "senderType"
        FROM "Message"
       WHERE "customerId" IN (${Prisma.join(customerIds)})
       ORDER BY "customerId", "createdAt" DESC, "id" DESC`;

    return new Map(rows.map((r) => [r.customerId, r]));
  }

  /**
   * CH-3 — the officer's conversation list.
   *
   * A DIFFERENT RESOURCE from "my customers", deliberately. A conversation
   * list needs a name, a picture, an excerpt, a time and an unread count, and
   * nothing else: modelling it as a filtered customer list made the screen pay
   * for wallet balances, stock figures and ERP credit lookups it never
   * renders, and forced the client to fetch a window of accounts and narrow it
   * in the browser.
   *
   * CONVERSATIONS ONLY: a customer the officer has never exchanged a message
   * with does not appear at all, so there is nothing for the client to filter
   * out. Ordered by recency across the WHOLE portfolio, then paged — not one
   * page of customers re-sorted, which is what silently went wrong past 100
   * accounts.
   *
   * `search` matches name, account number and phone, exactly as it does on
   * GET /officers/customers, so the two screens agree on what a search means.
   *
   * READ-ONLY: listing conversations does NOT mark anything read. The unread
   * count is shared across staff, so a list that cleared it would clear it for
   * everyone and destroy the only signal saying who is waiting. Only opening a
   * thread (GET /chat/{customerId}) marks it read.
   */
  async getChats(
    user: OfficerPortalUser,
    query: {
      page: number;
      pageSize: number;
      search?: string;
    } = { page: 1, pageSize: 20 },
  ) {
    const roleScope: Prisma.CustomerWhereInput =
      user.role === 'ADMIN' ? {} : this.portfolioOf(user.id);

    const and: Prisma.CustomerWhereInput[] = [
      roleScope,
      // The whole point of the resource: a thread with at least one message.
      { messages: { some: {} } },
    ];

    const term = query.search?.trim();
    if (term) {
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { erpId: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.CustomerWhereInput = { AND: and };

    // Recency lives on Message, not Customer, so the ordering cannot be a
    // Prisma orderBy. The matching set is resolved first, sorted by last
    // message, and only then paged — so the top of page 1 is the most recent
    // conversation in the whole portfolio rather than of one window.
    const customers = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        erpId: true,
        profilePhotoUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    if (customers.length === 0) {
      return paginateInMemory([], {
        page: query.page,
        pageSize: query.pageSize,
      });
    }

    const customerIds = customers.map((c) => c.id);
    const [lastMessages, unread, lastMessageRows] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _max: { createdAt: true },
      }),
      this.prisma.message.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, ...UNREAD_FROM_CUSTOMER },
        _count: { _all: true },
      }),
      this.lastMessagesFor(customerIds),
    ]);

    const lastAtMap = new Map(
      lastMessages.map((r) => [r.customerId, r._max.createdAt]),
    );
    const unreadMap = new Map(unread.map((r) => [r.customerId, r._count._all]));

    const rows = customers.map((c) => ({
      customerId: c.id,
      name: c.name,
      accountNumber: c.erpId,
      avatarUrl: c.profilePhotoUrl,
      lastMessagePreview: messagePreview(lastMessageRows.get(c.id)),
      lastMessageSenderType: lastMessageRows.get(c.id)?.senderType ?? null,
      lastMessageAt: lastAtMap.get(c.id) ?? null,
      // The same count GET /officers/customers reports, from the same
      // predicate — the two appearing on one screen and disagreeing would be
      // worse than either being absent.
      unreadMessages: unreadMap.get(c.id) ?? 0,
    }));

    // Newest first. `compareBy` sorts nulls last in both directions, so a
    // thread whose messages were somehow all removed sinks rather than
    // floating to the top.
    rows.sort(compareBy((r) => r.lastMessageAt, 'desc'));

    return paginateInMemory(rows, {
      page: query.page,
      pageSize: query.pageSize,
    });
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
      walletBalance: await this.balanceFor(customer),
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
    return {
      ...customer,
      // Same ERP-derived figure as the list, the overview tab and
      // GET /customers/me - the stored column is not trustworthy on its own.
      outstandingBalance: await this.balanceFor(customer),
      purchases,
      payments,
      supportTickets,
    };
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
