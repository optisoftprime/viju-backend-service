import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL } from './stock-balance';

/** One product line of the stock-balance breakdown. */
export interface ErpStockBalanceProduct {
  /** ERP ITEM_CODE. Null when the feed carries none for this product. */
  itemCode: string | null;
  productName: string;
  quantityPaid: number;
  quantityLoaded: number;
  quantityRemaining: number;
}

/**
 * An inclusive window on the order date. Either bound may be omitted, which
 * leaves that end open.
 */
export interface ErpStockDateRange {
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * A customer's stock position as the ERP states it. Totals and per-product
 * rows come from one query, so the breakdown always adds up to the totals.
 */
export interface ErpStockBalance {
  totalPurchasedCartons: number;
  totalLoadedCartons: number;
  totalRemainingCartons: number;
  products: ErpStockBalanceProduct[];
}

/**
 * Stock balance derived live from the ERP sales-order feed, using the mapping
 * documented in `stock-balance.ts`:
 *
 *   Stock Balance = SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY)
 *
 * One source for both GET /customers/me/home and
 * GET /customers/me/stock-balance, so the two can no longer disagree.
 */
@Injectable()
export class ErpStockBalanceService {
  private readonly logger = new Logger(ErpStockBalanceService.name);

  /** Cached probe for the sales-order feed; null until first checked. */
  private available: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True when this database carries the ERP sales-order feed. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_sales_order') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
      if (!this.available) {
        this.logger.warn(
          'erp_raw.raw_sales_order not found — stock balance falls back to the ' +
            'locally projected purchases. This is expected on a database ' +
            'without the ERP feed.',
        );
      }
    } catch (e) {
      this.available = false;
      this.logger.error(
        `Could not probe erp_raw.raw_sales_order: ${(e as Error).message}. Treating it as absent.`,
      );
    }
    return this.available;
  }

  /**
   * The ERP stock position for one customer, by CUSTOMER_CODE (`erpId`).
   *
   * Returns null - never zeros - when the feed is absent or holds no orders
   * for this customer. Callers fall back to the locally projected figure
   * rather than telling a distributor they have no stock on the strength of a
   * missing feed. A customer the ERP genuinely knows, who has collected
   * everything, comes back as real zeros instead.
   *
   * `range` narrows it to orders placed inside a window. A window the
   * customer has no orders in returns null - "we cannot say" - exactly as an
   * unknown customer does; the caller decides what to render, and for the
   * breakdown that is real zeros rather than a silent fallback to the
   * unfiltered local figure.
   */
  async getStockBalance(
    erpId: string,
    range?: ErpStockDateRange,
  ): Promise<ErpStockBalance | null> {
    if (!erpId) return null;
    if (!(await this.isAvailable())) return null;
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        {
          product: string | null;
          ordered_qty: string | number | null;
          delivered_qty: string | number | null;
          item_code: string | null;
        }[]
      >(
        ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL,
        erpId,
        range?.startDate ?? null,
        range?.endDate ?? null,
      );

      // No rows at all means the ERP has no order history we can tie to this
      // customer — treat it as "unknown", not "nothing".
      if (rows.length === 0) return null;

      const num = (v: string | number | null): number => {
        const parsed = Number(v ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const products = rows.map((r) => {
        const quantityPaid = num(r.ordered_qty);
        const quantityLoaded = num(r.delivered_qty);
        return {
          itemCode: r.item_code ?? null,
          productName: r.product ?? 'Unspecified',
          quantityPaid,
          quantityLoaded,
          // Floored per product so a single over-delivered line cannot show a
          // negative quantity against a product on screen.
          quantityRemaining: Math.max(0, quantityPaid - quantityLoaded),
        };
      });

      const totalPurchasedCartons = products.reduce(
        (a, p) => a + p.quantityPaid,
        0,
      );
      const totalLoadedCartons = products.reduce(
        (a, p) => a + p.quantityLoaded,
        0,
      );

      products.sort(
        (a, b) =>
          b.quantityRemaining - a.quantityRemaining ||
          a.productName.localeCompare(b.productName),
      );

      return {
        totalPurchasedCartons,
        totalLoadedCartons,
        // The total is derived from the totals, not from the floored per-product
        // rows, so it stays exactly purchased - loaded. Floored at zero: the
        // feed carries a handful of lines delivered above what was ordered.
        totalRemainingCartons: Math.max(
          0,
          totalPurchasedCartons - totalLoadedCartons,
        ),
        products,
      };
    } catch (e) {
      this.logger.error(
        `getStockBalance(${erpId}) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
