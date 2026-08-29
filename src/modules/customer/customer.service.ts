import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StatementLedgerService } from './statement-ledger.service';
import {
  UpdateProfilePhotoDto,
  ChangePasswordDto,
  PurchaseFilterDto,
} from './dto/customer.dto';
import * as bcrypt from 'bcryptjs';
import {
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  paginate,
} from '../../common/pagination/paginate';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';
import { messagePreview } from '../../common/messaging/message-preview';
import { ErpOrderLinesService } from '../erp/erp-order-lines.service';
import { ErpWaybillsService } from '../erp/erp-waybills.service';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StatementLedgerService,
    private readonly accountBalance: ErpAccountBalanceService,
    private readonly stockBalance: ErpStockBalanceService,
    private readonly orderLines: ErpOrderLinesService,
    private readonly erpWaybills: ErpWaybillsService,
  ) {}

  /**
   * The account balance to show the distributor.
   *
   * Derived live from the ERP customer-credit feed
   * (CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY, see
   * `src/modules/erp/account-balance.ts`) rather than read from the stored
   * column, because the projector that writes that column copies the ERP's
   * raw CREDIT_PAY into it — which inverts the sign for every customer
   * holding credit. Computing it here means the app is correct without
   * waiting for a reconcile pass to have run.
   *
   * Falls back to the stored column when the ERP feed is absent (CI, a fresh
   * local database) or holds no credit record for this customer, so the
   * endpoint keeps working rather than reporting a zero the ERP never stated.
   */
  private async resolveBalance(erpId: string, stored: number): Promise<number> {
    const derived = await this.accountBalance.getRunningBalance(erpId);
    return derived ?? stored;
  }

  async getHome(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        erpId: true,
        name: true,
        profilePhotoUrl: true,
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
    // Aggregate paid vs loaded across all orders so the home Stock Balance
    // card can show "<loaded> of <total>" + a progress bar. Loaded is capped
    // at paid per order so the bar never exceeds 100%.
    let totalPaidCartons = 0;
    let totalLoadedCartons = 0;
    for (const p of purchases) {
      const paidQty = p.items.reduce((a, i) => a + i.quantity, 0);
      const loadedQty = p.loadingRequests.reduce(
        (a, r) => a + (r.quantityCartons ?? 0),
        0,
      );
      totalPaidCartons += paidQty;
      totalLoadedCartons += Math.min(loadedQty, paidQty);
    }
    let remainingCartons = Math.max(0, totalPaidCartons - totalLoadedCartons);

    // The ERP states both sides of this directly:
    //   Stock Balance = SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY)
    // Prefer it over the locally projected purchases, and use the SAME source
    // as GET /customers/me/stock-balance so the two screens agree. Null means
    // the feed is absent or has no orders for this customer, in which case the
    // projected figures above stand.
    const erpStock = await this.stockBalance.getStockBalance(customer.erpId);
    if (erpStock) {
      totalPaidCartons = erpStock.totalPurchasedCartons;
      totalLoadedCartons = erpStock.totalLoadedCartons;
      remainingCartons = erpStock.totalRemainingCartons;
    }

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
      // F-1 - `description` carries the offer's terms as readable, selectable
      // text. The distributor app is the whole point of that copy, so it ships
      // with the carousel rather than only on the admin list.
      select: { id: true, imageUrl: true, name: true, description: true },
    });

    const [accountBalanceAmount, temporarilyCredit] = await Promise.all([
      this.resolveBalance(customer.erpId, customer.outstandingBalance),
      // Supplementary credit whose EFFECTIVE_DATE..INEFFECTIVE_DATE window
      // contains today, summed across every grant the ERP holds for this
      // customer. 0 when nothing is in force.
      this.accountBalance.getTemporaryCredit(customer.erpId),
    ]);

    return {
      customerName: customer.name,
      profilePhotoUrl: customer.profilePhotoUrl,
      temporarilyCredit,
      accountBalance: {
        amount: accountBalanceAmount,
        lastUpdated: customer.updatedAt,
        isLow: accountBalanceAmount < 0,
      },
      stockBalance: {
        totalCartons: totalPaidCartons,
        loadedCartons: totalLoadedCartons,
        remainingCartons,
        lastUpdated: customer.updatedAt,
      },
      productFlyers,
      recentPurchases,
    };
  }

  /**
   * The distributor's conversation list - one row per ACCOUNT OFFICER assigned
   * to them, most recently active first.
   *
   * The mirror of GET /officers/chats, with two deliberate differences:
   *
   * 1. It shows the OFFICER'S NAME - as every customer-facing surface now
   *    does. A distributor cannot choose who to message when everyone is
   *    called the same thing.
   *
   * 2. It lists officers with NO MESSAGES YET. The officer version omits
   *    empty threads because it is a list of conversations; this one is a list
   *    of people to start a conversation WITH, so an officer the distributor
   *    has never written to still has to appear.
   *
   * A thread is per officer: messages carrying that officer's `staffId`.
   */
  async getOfficerChats(customerId: string) {
    const assignments = await this.prisma.customerOfficer.findMany({
      where: { customerId },
      select: {
        isPrimary: true,
        staff: {
          select: {
            id: true,
            name: true,
            profilePhotoUrl: true,
            isActive: true,
          },
        },
      },
    });

    // The primary pointer is authoritative even when no CustomerOfficer row
    // exists for it yet - a reassignment writes the pointer first.
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        assignedOfficerId: true,
        assignedOfficer: {
          select: {
            id: true,
            name: true,
            profilePhotoUrl: true,
            isActive: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer profile not found');

    const officers = new Map<
      string,
      {
        id: string;
        name: string;
        profilePhotoUrl: string | null;
        isActive: boolean;
        isPrimary: boolean;
      }
    >();
    for (const a of assignments) {
      if (a.staff)
        officers.set(a.staff.id, { ...a.staff, isPrimary: a.isPrimary });
    }
    if (customer.assignedOfficer) {
      const existing = officers.get(customer.assignedOfficer.id);
      officers.set(customer.assignedOfficer.id, {
        ...customer.assignedOfficer,
        // The pointer wins: it is what sendFromCustomer routes to.
        isPrimary: true,
        ...(existing ? {} : {}),
      });
    }

    // A deactivated officer cannot answer, so listing them as someone to
    // message would be a dead end.
    const active = [...officers.values()].filter((o) => o.isActive);
    if (active.length === 0) return [];

    const staffIds = active.map((o) => o.id);
    const [lastAt, unread, previews] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['staffId'],
        where: { customerId, staffId: { in: staffIds } },
        _max: { createdAt: true },
      }),
      // The mirror of the officer side's unread count: messages the OFFICER
      // sent that this distributor has not read yet.
      this.prisma.message.groupBy({
        by: ['staffId'],
        where: {
          customerId,
          staffId: { in: staffIds },
          senderType: 'STAFF',
          readAt: null,
        },
        _count: { _all: true },
      }),
      this.lastMessagePerOfficer(customerId, staffIds),
    ]);

    const lastAtMap = new Map(lastAt.map((r) => [r.staffId, r._max.createdAt]));
    const unreadMap = new Map(unread.map((r) => [r.staffId, r._count._all]));

    const rows = active.map((o) => ({
      officerId: o.id,
      // PRD F6 is deliberately not applied here - see the method comment.
      name: o.name,
      avatarUrl: o.profilePhotoUrl,
      isPrimary: o.isPrimary,
      lastMessagePreview: messagePreview(previews.get(o.id)),
      lastMessageSenderType: previews.get(o.id)?.senderType ?? null,
      lastMessageAt: lastAtMap.get(o.id) ?? null,
      unreadMessages: unreadMap.get(o.id) ?? 0,
    }));

    // Most recently active first; an officer never messaged sinks to the
    // bottom rather than floating, with the primary leading that tail so the
    // distributor's default contact is the first one they can start with.
    rows.sort((a, b) => {
      const at = a.lastMessageAt?.getTime() ?? null;
      const bt = b.lastMessageAt?.getTime() ?? null;
      if (at !== null && bt !== null) return bt - at;
      if (at !== null) return -1;
      if (bt !== null) return 1;
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return rows;
  }

  /** Newest message per officer on this customer's account. */
  private async lastMessagePerOfficer(
    customerId: string,
    staffIds: string[],
  ): Promise<
    Map<
      string,
      {
        content: string | null;
        attachmentUrl: string | null;
        senderType: string;
      }
    >
  > {
    if (staffIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      {
        staffId: string;
        content: string | null;
        attachmentUrl: string | null;
        senderType: string;
      }[]
    >`
      SELECT DISTINCT ON ("staffId")
             "staffId", content, "attachmentUrl", "senderType"
        FROM "Message"
       WHERE "customerId" = ${customerId}
         AND "staffId" = ANY(${staffIds})
       ORDER BY "staffId", "createdAt" DESC`;
    return new Map(rows.map((r) => [r.staffId, r]));
  }

  /**
   * The ERP's own goods-movement documents for this distributor.
   *
   * Keyed on the customer's ERP code, so it reports what the ERP holds even
   * for orders the projector has never copied into `Purchase`.
   */
  async getErpWaybills(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { erpId: true },
    });
    if (!customer) throw new NotFoundException('Customer profile not found');
    return this.erpWaybills.list(customer.erpId, pagination);
  }

  async getStockBalanceBreakdown(customerId: string) {
    // Same ERP derivation as the home screen's Stock Balance card, so the two
    // can no longer report different numbers for the same distributor.
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { erpId: true },
    });
    const erpStock = customer
      ? await this.stockBalance.getStockBalance(customer.erpId)
      : null;
    if (erpStock) {
      return {
        totalPurchasedCartons: erpStock.totalPurchasedCartons,
        totalLoadedCartons: erpStock.totalLoadedCartons,
        totalRemainingCartons: erpStock.totalRemainingCartons,
        loadingProgress:
          erpStock.totalPurchasedCartons > 0
            ? Math.round(
                (erpStock.totalLoadedCartons / erpStock.totalPurchasedCartons) *
                  100,
              )
            : 0,
        products: erpStock.products,
      };
    }

    // Fallback: the locally projected purchases, unchanged. Used only where
    // the ERP sales-order feed is absent or silent about this customer.
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

    const totalPurchasedCartons = breakdown.reduce(
      (a, r) => a + r.quantityPaid,
      0,
    );
    const totalLoadedCartons = breakdown.reduce(
      (a, r) => a + r.quantityLoaded,
      0,
    );
    const totalRemainingCartons = breakdown.reduce(
      (a, r) => a + r.quantityRemaining,
      0,
    );
    const loadingProgress =
      totalPurchasedCartons > 0
        ? Math.round((totalLoadedCartons / totalPurchasedCartons) * 100)
        : 0;

    return {
      totalPurchasedCartons,
      totalLoadedCartons,
      totalRemainingCartons,
      loadingProgress,
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
        email: true,
        region: true,
        accountStatus: true,
        outstandingBalance: true,
        profilePhotoUrl: true,
        assignedOfficer: { select: { id: true, name: true } },
      },
    });

    if (!customer) throw new NotFoundException('Customer profile not found');

    // The distributor now sees their officer's real name. This used to be the
    // fixed 'Viju Account Officer' label (PRD F6). `displayName` is kept as
    // the field name so existing clients bind unchanged - only the value moves
    // from a constant to the officer's name.
    const { assignedOfficer, ...rest } = customer;
    return {
      ...rest,
      outstandingBalance: await this.resolveBalance(
        customer.erpId,
        customer.outstandingBalance,
      ),
      accountOfficer: assignedOfficer
        ? {
            id: assignedOfficer.id,
            displayName: assignedOfficer.name,
          }
        : null,
    };
  }

  async updatePhoto(customerId: string, dto: UpdateProfilePhotoDto) {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { profilePhotoUrl: dto.photoUrl },
    });
    // Return the safe profile shape — never echo the raw record (it carries
    // the password hash and other internal fields).
    return this.getProfile(customerId);
  }

  async changePassword(customerId: string, dto: ChangePasswordDto) {
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { password: hashedPassword },
    });
  }

  async getPurchases(
    customerId: string,
    filter: PurchaseFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
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

    const page = await paginate(
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

    // The projector has copied lines for 30 of 10,350 orders, so `items` is
    // empty on almost every row. Fill the gaps from the ERP feed - one batched
    // query for the page, never one per row.
    const missing = page.data.filter((p) => p.items.length === 0);
    if (missing.length === 0) return page;
    const erpLines = await this.orderLines.getLinesByOrder(
      missing.map((p) => p.erpId),
    );
    return {
      ...page,
      data: page.data.map((purchase) =>
        purchase.items.length > 0
          ? purchase
          : {
              ...purchase,
              items: (erpLines.get(purchase.erpId) ?? []).map((l) => ({
                id: l.id,
                purchaseId: purchase.id,
                productName: l.productName,
                itemCode: l.itemCode,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineTotal: l.lineTotal,
              })),
            },
      ),
    };
  }

  async getPurchaseDetail(customerId: string, purchaseId: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id: purchaseId, customerId },
      include: {
        items: {
          select: {
            id: true,
            productName: true,
            itemCode: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Order not found');

    // B-5.4 — the six columns the detail screen renders. `accountBalance` is
    // the running balance at the moment of this transaction, computed by the
    // ledger so it agrees with the statement rather than being recalculated
    // on the client.
    const balances = await this.ledger.balanceByPurchase(customerId);
    const accountBalance = balances.get(purchase.id) ?? 0;

    // `lines` used to render empty for almost every order, because the
    // projector copies PurchaseItem for barely any of them. Fall back to the
    // ERP feed, which states the product and quantity per line but no
    // per-line money - see order-lines.ts.
    const erpLines =
      purchase.items.length === 0
        ? await this.orderLines.getLines(purchase.erpId)
        : [];
    const lineSource =
      purchase.items.length > 0
        ? purchase.items.map((i) => ({
            id: i.id,
            productName: i.productName,
            itemCode: i.itemCode ?? null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
          }))
        : erpLines;

    return {
      id: purchase.id,
      orderId: purchase.erpId,
      orderDate: purchase.orderDate,
      status: purchase.status,
      statusUpdatedAt: purchase.statusUpdatedAt ?? null,
      totalItems: purchase.totalItems,
      totalValue: purchase.totalValue,
      linkedInvoiceNumber: this.deriveInvoiceNumber(purchase.erpId),
      accountBalance,
      lines: lineSource.map((i) => ({
        product: i.productName,
        itemCode: i.itemCode,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.lineTotal,
        accountBalance,
      })),
      // Retained for the existing screens; `lines` is the B-5.4 shape.
      items: lineSource.map((i) => ({
        id: i.id,
        purchaseId: purchase.id,
        productName: i.productName,
        itemCode: i.itemCode,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
    };
  }

  /**
   * Until the real ERP supplies invoice numbers, derive a stable one
   * from the purchase ERP id. Format mirrors what the FE shows in Figma
   * (e.g. order VJ-2026-675 -> invoice INV-444120).
   */
  private deriveInvoiceNumber(purchaseErpId: string): string {
    const digits = purchaseErpId.replace(/\D/g, '');
    const tail = digits.slice(-6).padStart(6, '0');
    return `INV-${tail}`;
  }

  async getPayments(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { customerId };
    return paginate(
      () => this.prisma.payment.count({ where }),
      (skip, take) =>
        this.prisma.payment.findMany({
          where,
          orderBy: { date: 'desc' },
          skip,
          take,
        }),
      pagination,
    );
  }

  /**
   * The Account tab: wallet balance, invoices and payment history.
   *
   * BOTH lists are paginated. They were unbounded, and they grow without
   * limit - one distributor already has 4,660 invoices and 6,796 payments,
   * so a single response carried 11,456 rows. `page` and `pageSize` apply to
   * both; each reports its own totals, so neither is silently truncated.
   */
  async getInvoices(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const page = Math.max(1, Math.floor(pagination.page || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(pagination.pageSize || 20)),
    );
    const skip = (page - 1) * pageSize;

    const [customer, purchases, invoiceTotal, payments, paymentTotal] =
      await Promise.all([
        this.prisma.customer.findUnique({
          where: { id: customerId },
          select: {
            erpId: true,
            outstandingBalance: true,
            updatedAt: true,
            assignedOfficer: { select: { id: true } },
          },
        }),
        this.prisma.purchase.findMany({
          where: { customerId },
          orderBy: { orderDate: 'desc' },
          select: {
            id: true,
            erpId: true,
            orderDate: true,
            totalValue: true,
            status: true,
          },
          skip,
          take: pageSize,
        }),
        this.prisma.purchase.count({ where: { customerId } }),
        this.prisma.payment.findMany({
          where: { customerId },
          orderBy: { date: 'desc' },
          select: {
            id: true,
            date: true,
            amount: true,
            reference: true,
            runningBalance: true,
          },
          skip,
          take: pageSize,
        }),
        this.prisma.payment.count({ where: { customerId } }),
      ]);
    if (!customer) throw new NotFoundException('Customer not found');

    const invoices = purchases.map((p) => ({
      id: p.id,
      invoiceNumber: this.deriveInvoiceNumber(p.erpId),
      orderId: p.erpId,
      date: p.orderDate,
      totalAmount: p.totalValue,
      status: this.deriveInvoiceStatus(p.status),
    }));

    const walletAmount = await this.resolveBalance(
      customer.erpId,
      customer.outstandingBalance,
    );

    return {
      walletBalance: {
        amount: walletAmount,
        isOverdue: walletAmount < 0,
        lastUpdated: customer.updatedAt,
      },
      contactNote: 'To make a payment, contact your Viju Account Officer.',
      invoices,
      // Paginates `invoices`, the tab's primary list.
      meta: buildPaginationMeta(invoiceTotal, page, pageSize),
      paymentHistory: payments,
      // Its own totals: the two lists are different lengths, so one meta
      // could not describe both without silently truncating the longer.
      paymentHistoryMeta: buildPaginationMeta(paymentTotal, page, pageSize),
    };
  }

  async getInvoiceDetail(customerId: string, invoiceId: string) {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id: invoiceId, customerId },
      include: {
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
      },
    });
    if (!purchase) throw new NotFoundException('Invoice not found');

    // Same gap as the order detail: PurchaseItem is empty for almost every
    // order, so `lineItems` rendered blank. The ERP feed supplies product and
    // quantity per line, but no per-line money - see order-lines.ts.
    const erpLines =
      purchase.items.length === 0
        ? await this.orderLines.getLines(purchase.erpId)
        : [];
    const lineItems =
      purchase.items.length > 0
        ? purchase.items.map((i) => ({
            id: i.id,
            productName: i.productName,
            itemCode: null as string | null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
          }))
        : erpLines;

    // Summing null line totals would report 0 for an order worth millions, so
    // the ERP-sourced case falls back to the order total the ERP does state.
    const subtotal =
      purchase.items.length > 0
        ? purchase.items.reduce((a, i) => a + i.lineTotal, 0)
        : purchase.totalValue;
    const tax = 0;
    return {
      id: purchase.id,
      invoiceNumber: this.deriveInvoiceNumber(purchase.erpId),
      orderId: purchase.erpId,
      date: purchase.orderDate,
      status: this.deriveInvoiceStatus(purchase.status),
      lineItems,
      subtotal,
      tax,
      grandTotal: subtotal + tax,
    };
  }

  /**
   * Maps the underlying OrderStatus onto PRD F4's invoice statuses.
   * Until invoices are modelled separately, status is inferred from the
   * order lifecycle.
   */
  private deriveInvoiceStatus(
    orderStatus: string,
  ): 'PAID' | 'PART_PAID' | 'UNPAID' {
    switch (orderStatus) {
      // Settled and closed off in the ERP, or received by the distributor.
      case 'CLOSED':
      case 'DELIVERED':
        return 'PAID';
      // Approved and somewhere in flight.
      case 'PROCESSING':
      case 'LOADED':
      case 'DISPATCHED':
      case 'SHIPPED':
        return 'PART_PAID';
      // PENDING (raised, not yet approved) and CANCELLED.
      default:
        return 'UNPAID';
    }
  }
}
