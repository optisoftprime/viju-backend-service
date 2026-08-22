import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** B-5.2 — windows the statement can be pulled for. */
export const STATEMENT_PERIODS = [
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_6_MONTHS',
  'YEAR_TO_DATE',
  'CUSTOM',
] as const;
export type StatementPeriod = (typeof STATEMENT_PERIODS)[number];

/** B-5.1 — the movement types a statement line can carry. */
export const STATEMENT_LINE_TYPES = [
  'INVOICE',
  'PAYMENT',
  'TRANSPORT_ALLOWANCE',
] as const;
export type StatementLineType = (typeof STATEMENT_LINE_TYPES)[number];

export interface ResolvedPeriod {
  period: StatementPeriod;
  from: Date;
  to: Date;
}

export interface StatementLine {
  date: Date;
  type: StatementLineType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface Statement {
  customerName: string;
  code: string;
  period: StatementPeriod;
  startDate: Date;
  endDate: Date;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: StatementLine[];
}

/** Movement before the running balance is applied. */
interface Movement {
  date: Date;
  type: StatementLineType;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  /** Stable tie-break for movements sharing a timestamp. */
  sortKey: string;
}

/**
 * Deterministic order for movements that land on the same timestamp, so the
 * running balance is reproducible instead of depending on row order.
 */
const TYPE_ORDER: Record<StatementLineType, number> = {
  INVOICE: 0,
  PAYMENT: 1,
  TRANSPORT_ALLOWANCE: 2,
};

/**
 * Builds the account statement ledger (B-5.1, B-5.2, B-5.5).
 *
 * Balance convention, exactly as specified:
 *
 *   closingBalance = openingBalance + Σ(credit) − Σ(debit)
 *
 * so a credit (payment received, transport allowance granted) raises the
 * balance and a debit (invoice) lowers it. The running balance is computed
 * here, server-side, in strict chronological order — never on the client —
 * so web, mobile and the PDF cannot disagree.
 */
@Injectable()
export class StatementLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * B-5.2 — turns the query params into a concrete window.
   *
   * Defaults to LAST_30_DAYS when `period` is omitted. `startDate`/`endDate`
   * are required only for CUSTOM, and an inverted range is a 400.
   */
  resolvePeriod(input: {
    period?: StatementPeriod;
    startDate?: string;
    endDate?: string;
  }): ResolvedPeriod {
    const period = input.period ?? 'CUSTOM';
    const now = new Date();

    // A bare startDate/endDate with no `period` keeps the older ad-hoc range
    // behaviour working.
    if (!input.period && (input.startDate || input.endDate)) {
      const from = input.startDate ? new Date(input.startDate) : new Date(0);
      const to = input.endDate ? new Date(input.endDate) : now;
      this.assertOrdered(from, to);
      return { period: 'CUSTOM', from, to };
    }

    if (period === 'CUSTOM') {
      if (!input.startDate || !input.endDate) {
        if (!input.period) {
          // No period and no dates at all — the documented default.
          return {
            period: 'LAST_30_DAYS',
            from: this.daysAgo(now, 30),
            to: now,
          };
        }
        throw new BadRequestException(
          'startDate and endDate are both required when period=CUSTOM.',
        );
      }
      const from = new Date(input.startDate);
      const to = new Date(input.endDate);
      this.assertOrdered(from, to);
      return { period, from, to };
    }

    switch (period) {
      case 'LAST_30_DAYS':
        return { period, from: this.daysAgo(now, 30), to: now };
      case 'LAST_90_DAYS':
        return { period, from: this.daysAgo(now, 90), to: now };
      case 'LAST_6_MONTHS': {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 6);
        return { period, from, to: now };
      }
      case 'YEAR_TO_DATE':
        return {
          period,
          from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
          to: now,
        };
    }
  }

  /** The statement for one customer over a resolved window. */
  async build(customerId: string, range: ResolvedPeriod): Promise<Statement> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, erpId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const movements = await this.loadMovements(customerId);

    // Everything before the window collapses into the opening balance, so the
    // window's first line continues from the right number rather than zero.
    const opening = movements
      .filter((m) => m.date < range.from)
      .reduce((sum, m) => sum + m.credit - m.debit, 0);

    const inWindow = movements.filter(
      (m) => m.date >= range.from && m.date <= range.to,
    );

    let balance = opening;
    let totalDebit = 0;
    let totalCredit = 0;
    const lines: StatementLine[] = inWindow.map((m) => {
      balance = balance + m.credit - m.debit;
      totalDebit += m.debit;
      totalCredit += m.credit;
      return {
        date: m.date,
        type: m.type,
        reference: m.reference,
        description: m.description,
        debit: m.debit,
        credit: m.credit,
        runningBalance: balance,
      };
    });

    return {
      customerName: customer.name,
      code: customer.erpId,
      period: range.period,
      startDate: range.from,
      endDate: range.to,
      // AO-D1 - full precision, never pre-rounded: a figure rounded here
      // cannot be recovered by the client, and the statement would silently
      // disagree with the ERP. The portal formats for display.
      openingBalance: opening,
      closingBalance: balance,
      totalDebit,
      totalCredit,
      lines,
    };
  }

  /**
   * Running balance at the moment of each purchase, keyed by purchase id —
   * the `accountBalance` column on the order/payment detail screen (B-5.4).
   */
  async balanceByPurchase(customerId: string): Promise<Map<string, number>> {
    const movements = await this.loadMovements(customerId);
    const out = new Map<string, number>();
    let balance = 0;
    for (const m of movements) {
      balance = balance + m.credit - m.debit;
      if (m.sortKey.startsWith('purchase:')) {
        out.set(m.sortKey.slice('purchase:'.length), balance);
      }
    }
    return out;
  }

  /**
   * Every movement on the account, oldest first.
   *
   * Invoices come from purchases; payments from the payment ledger. A payment
   * that settles a broadcast delivery allowance is a TRANSPORT_ALLOWANCE
   * rather than an ordinary PAYMENT — that link is what separates the three
   * movement types the statement must distinguish (B-5.1).
   */
  private async loadMovements(customerId: string): Promise<Movement[]> {
    const [purchases, payments] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { customerId },
        select: {
          id: true,
          erpId: true,
          orderDate: true,
          totalValue: true,
          totalItems: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { customerId },
        select: {
          id: true,
          date: true,
          amount: true,
          reference: true,
          erpId: true,
          broadcast: { select: { reference: true, deliveryAllowance: true } },
        },
      }),
    ]);

    const movements: Movement[] = [
      ...purchases.map(
        (p): Movement => ({
          date: p.orderDate,
          type: 'INVOICE',
          reference: p.erpId,
          description: `Invoice ${p.erpId} — ${p.totalItems} item(s)`,
          debit: p.totalValue,
          credit: 0,
          sortKey: `purchase:${p.id}`,
        }),
      ),
      ...payments.map((p): Movement => {
        const isAllowance = p.broadcast !== null;
        return {
          date: p.date,
          type: isAllowance ? 'TRANSPORT_ALLOWANCE' : 'PAYMENT',
          reference: p.reference ?? p.broadcast?.reference ?? p.erpId ?? p.id,
          description: isAllowance
            ? 'Transport allowance credited'
            : 'Payment received',
          debit: 0,
          credit: p.amount,
          sortKey: `payment:${p.id}`,
        };
      }),
    ];

    // Chronological, with a documented tie-break: same instant → invoices
    // before payments before allowances, then by id. Stable and reproducible.
    movements.sort((a, b) => {
      const byDate = a.date.getTime() - b.date.getTime();
      if (byDate !== 0) return byDate;
      const byType = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      if (byType !== 0) return byType;
      return a.sortKey.localeCompare(b.sortKey);
    });

    return movements;
  }

  private assertOrdered(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException(
        'startDate and endDate must be valid dates.',
      );
    }
    if (from > to) {
      throw new BadRequestException('startDate must not be after endDate.');
    }
  }

  private daysAgo(from: Date, days: number): Date {
    const d = new Date(from);
    d.setDate(d.getDate() - days);
    return d;
  }

  /**
   * AO-D1 - money crosses the wire at full precision.
   *
   * Amounts used to be rounded to kobo here as a float-drift guard. Rounding
   * a source value (`Purchase.totalValue`, `Payment.amount`) is not
   * recoverable by the client, so the statement disagreed with the ERP by up
   * to a kobo per line. Accumulation error over a statement is many orders of
   * magnitude smaller than that, so the guard cost more than it bought.
   */
}
