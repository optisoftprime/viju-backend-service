import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate, paginateInMemory } from '../../common/pagination/paginate';
import {
  SortOrder,
  compareBy,
  sortDirection,
} from '../../common/pagination/sort.dto';
import { AssignedCustomerSortField } from './dto/officer-request.dto';
import { stockByCustomer } from '../../common/customers/stock-balance';
import { displayPhone } from '../../common/customers/display-phone';
import { messagePreview } from '../../common/messaging/message-preview';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';
import {
  balanceByErpId,
  balanceForCustomer,
} from '../../common/customers/account-balance';
import { CustomerService } from '../customer/customer.service';
import { PurchaseFilterDto } from '../customer/dto/customer.dto';

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
    private readonly stockBalance: ErpStockBalanceService,
    // The distributor-facing service, reused verbatim for the per-customer
    // tabs. The officer portal must show a distributor EXACTLY what that
    // distributor sees, so the two are served by one implementation rather
    // than by two that agree today and drift tomorrow. Scope is enforced
    // here, before the call; the reused method never sees the officer.
    private readonly customers: CustomerService,
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
    return balanceByErpId(this.accountBalance, rows);
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
      select: { id: true, erpId: true, outstandingBalance: true },
    });
    const customerIds = customers.map((c) => c.id);
    // Judged on the ERP-derived balance, not the stored column: that column's
    // sign is inverted for every customer holding credit, so this tile used to
    // count customers as overdue precisely when they were in credit.
    const balances = await balanceByErpId(this.accountBalance, customers);
    const overdueCount = customers.filter(
      (c) => (balances.get(c.erpId) ?? 0) < 0,
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
      stockByCustomer(this.prisma, rows, this.stockBalance),
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
      phone: displayPhone(c.phone),
      region: c.region,
      // Derived from the ERP credit feed, exactly as GET /customers/me does.
      walletBalance: accountBalances.get(c.erpId) ?? c.outstandingBalance,
      ...(stockBalances.get(c.id) ?? {
        totalStock: 0,
        stockLoaded: 0,
        stockBalanceCartons: 0,
      }),
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

  /**
   * The distributor's Invoices tab - the SAME order history the distributor
   * sees on GET /customers/me/invoices, paginated and filterable identically.
   *
   * `data` / `meta` are produced by the distributor-facing reader itself, so
   * the officer cannot be shown a different set of orders, a different row
   * shape or a different page size from the person whose account it is.
   *
   * `walletBalance` and `paymentHistory` stay alongside: they are the tab's
   * own figures, not part of the order list, and no distributor route
   * supersedes them.
   */
  async getCustomerInvoices(
    user: OfficerPortalUser,
    customerId: string,
    filter: PurchaseFilterDto = { page: 1, pageSize: 20 },
  ) {
    const scoped = await this.ensureAssignedCustomer(user, customerId);
    const [customer, page, payments, lastSync] = await Promise.all([
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { erpId: true, outstandingBalance: true, updatedAt: true },
      }),
      this.customers.getPurchases(customerId, filter, filter),
      this.prisma.payment.findMany({
        where: { customerId },
        orderBy: { date: 'desc' },
      }),
      this.prisma.purchase.aggregate({
        where: { customerId },
        _max: { updatedAt: true },
      }),
    ]);
    // US-10.7: when the ERP data behind this tab was last synced, NOT the
    // time of the request. Taken from the whole order history rather than the
    // current page, so paging cannot change the stamp.
    return {
      lastUpdated: this.latestDate([
        customer?.updatedAt ?? scoped.updatedAt,
        lastSync._max.updatedAt,
        ...payments.map((p) => p.createdAt),
      ]),
      // The ERP-derived balance, as every other screen shows it. This read
      // the stored column outright, so the Invoices tab could report a
      // different - and oppositely signed - balance from the Overview tab
      // beside it.
      walletBalance: customer
        ? await balanceForCustomer(this.accountBalance, customer)
        : 0,
      paymentHistory: payments,
      ...page,
    };
  }

  /**
   * One order in full, exactly as GET /customers/me/invoices/{id} returns it -
   * merged product lines, running account balance and all.
   *
   * The customer id is verified against the officer's portfolio FIRST, then
   * the order is read scoped to that customer, so an order id belonging to a
   * distributor outside the portfolio cannot be reached by pairing it with a
   * customer inside one.
   */
  async getCustomerInvoiceDetail(
    user: OfficerPortalUser,
    customerId: string,
    invoiceId: string,
  ) {
    await this.ensureAssignedCustomer(user, customerId);
    return this.customers.getPurchaseDetail(customerId, invoiceId);
  }

  /**
   * The distributor's Stock tab - the SAME stock balance the distributor sees
   * on GET /customers/me/stock-balance, including the date window.
   *
   * REPLACES the old `catalogue` shape, which derived reserved/awaiting
   * figures from the local `Stock` and `Purchase` tables by a different route
   * from the distributor's own screen and so could disagree with it. The
   * figures now come from the one ERP query both portals read.
   */
  async getCustomerStock(
    user: OfficerPortalUser,
    customerId: string,
    filter: { startDate?: string; endDate?: string } = {},
  ) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
    const balance = await this.customers.getStockBalanceBreakdown(
      customerId,
      filter,
    );
    return { lastUpdated: customer.updatedAt, ...balance };
  }

  /**
   * The distributor's Waybills tab - the ERP's OWN goods-movement records,
   * exactly as GET /customers/me/erp/waybills returns them.
   *
   * This used to list the portal's loading requests. Those have not been
   * lost: GET /officers/loading-requests is the officer's view of them, and
   * carries the assign and cancel actions besides. This tab now answers the
   * question the distributor's own Waybills screen answers - what the ERP
   * recorded as moved - which is what an officer looking at a distributor's
   * account needs to reconcile against.
   */
  async getCustomerWaybills(
    user: OfficerPortalUser,
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const customer = await this.ensureAssignedCustomer(user, customerId);
    const page = await this.customers.getErpWaybills(customerId, pagination);
    return { lastUpdated: customer.updatedAt, ...page };
  }

  /**
   * One ERP document with its item lines, as
   * GET /customers/me/erp/waybills/{docNo} returns it.
   *
   * Scoped twice over: the customer must be in the officer's portfolio, and
   * the document must belong to that customer. A document from elsewhere is a
   * plain 404, indistinguishable from one that does not exist.
   */
  async getCustomerWaybillDetail(
    user: OfficerPortalUser,
    customerId: string,
    docNo: string,
  ) {
    await this.ensureAssignedCustomer(user, customerId);
    return this.customers.getErpWaybillDetail(customerId, docNo);
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

  /**
   * GET /officers/stock - the stock balance across the officer's WHOLE
   * portfolio, in the same shape as one distributor's.
   *
   * Products are grouped ACROSS the distributors, so a product several of them
   * are holding appears once with the quantities added: this is "what is still
   * to collect in my book of accounts", not a per-customer split. The split is
   * GET /officers/customers/{id}/stock.
   *
   * SCOPE. An OFFICER sees the distributors assigned to them, primary or
   * secondary. An ADMIN has cross-region visibility everywhere else in this
   * controller, so they see every distributor rather than an empty portfolio.
   *
   * An empty portfolio, an absent ERP feed, or a window with no orders in it
   * all return honest zeros with an empty `products` - never a silent fallback
   * to some other figure.
   */
  async getStock(
    user: OfficerPortalUser,
    filter: { startDate?: string; endDate?: string } = {},
  ) {
    const startDate = filter.startDate ?? null;
    const endDate = filter.endDate ?? null;
    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('startDate must be on or before endDate.');
    }
    const dateRange = { startDate, endDate };
    const isAdmin = user.role === 'ADMIN';
    const customers = await this.prisma.customer.findMany({
      where: isAdmin
        ? {}
        : {
            OR: [
              { assignedOfficerId: user.id },
              { officerAssignments: { some: { staffId: user.id } } },
            ],
          },
      select: { erpId: true, updatedAt: true },
    });

    const balance = await this.stockBalance.getStockBalanceForCustomers(
      customers.map((c) => c.erpId),
      dateRange,
    );

    const empty = {
      totalPurchasedCartons: 0,
      totalLoadedCartons: 0,
      totalRemainingCartons: 0,
      loadingProgress: 0,
      products: [] as never[],
    };

    // Shaped exactly like one distributor's balance - the same keys in the
    // same order - so a screen can render either from one component.
    return {
      lastUpdated: this.latestDate(customers.map((c) => c.updatedAt)),
      customers: customers.length,
      ...(balance
        ? {
            totalPurchasedCartons: balance.totalPurchasedCartons,
            totalLoadedCartons: balance.totalLoadedCartons,
            totalRemainingCartons: balance.totalRemainingCartons,
            loadingProgress:
              balance.totalPurchasedCartons > 0
                ? Math.round(
                    (balance.totalLoadedCartons /
                      balance.totalPurchasedCartons) *
                      100,
                  )
                : 0,
            // Same rule as the distributor's own screen: a product collected
            // in full is not part of a stock balance.
            products: balance.products.filter((p) => p.quantityRemaining > 0),
          }
        : empty),
    };
  }
}
