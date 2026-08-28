import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StatementLedgerService } from './statement-ledger.service';
import {
  UpdateProfilePhotoDto,
  ChangePasswordDto,
  PurchaseFilterDto,
} from './dto/customer.dto';
import * as bcrypt from 'bcryptjs';
import { paginate } from '../../common/pagination/paginate';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StatementLedgerService,
    private readonly accountBalance: ErpAccountBalanceService,
    private readonly stockBalance: ErpStockBalanceService,
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
        assignedOfficer: { select: { id: true } },
      },
    });

    if (!customer) throw new NotFoundException('Customer profile not found');

    // PRD F8 AC2 + F6: customer never sees individual officer names.
    const { assignedOfficer, ...rest } = customer;
    return {
      ...rest,
      outstandingBalance: await this.resolveBalance(
        customer.erpId,
        customer.outstandingBalance,
      ),
      accountOfficer: assignedOfficer
        ? { displayName: 'Viju Account Officer' }
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
      lines: purchase.items.map((i) => ({
        product: i.productName,
        itemCode: i.itemCode ?? null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.lineTotal,
        accountBalance,
      })),
      // Retained for the existing screens; `lines` is the B-5.4 shape.
      items: purchase.items,
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

  async getInvoices(customerId: string) {
    const [customer, purchases, payments] = await Promise.all([
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
      }),
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
      }),
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
      // PRD F4 AC8 + F6: generic label only — never officer's actual name
      contactNote: 'To make a payment, contact your Viju Account Officer.',
      invoices,
      paymentHistory: payments,
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

    const subtotal = purchase.items.reduce((a, i) => a + i.lineTotal, 0);
    const tax = 0;
    return {
      id: purchase.id,
      invoiceNumber: this.deriveInvoiceNumber(purchase.erpId),
      orderId: purchase.erpId,
      date: purchase.orderDate,
      status: this.deriveInvoiceStatus(purchase.status),
      lineItems: purchase.items,
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
