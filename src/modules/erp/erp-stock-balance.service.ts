import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ErpItemCodeService } from './erp-item-code.service';
import { resolveProduct } from './product-specification.resolver';
import { stripCjk } from './strip-cjk';
import {
  ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL,
  ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL,
  ERP_CUSTOMER_IDS_FOR_CODES_SQL,
  ERP_STOCK_REMAINING_BY_CUSTOMER_SQL,
} from './stock-balance';

/** One product line of the stock-balance breakdown. */
export interface ErpStockBalanceProduct {
  /** ERP ITEM_CODE. Null when the feed carries none for this product. */
  itemCode: string | null;
  productName: string;
  /**
   * ITEM_SPECIFICATION with the ERP's Chinese category characters stripped.
   * Null where the feed states none, and ALSO null where the product's lines
   * disagree about it - rows group by product NAME, and 4 names span several
   * sizes, so one of them picked arbitrarily would be a guess.
   */
  spec: string | null;
  quantityPaid: number;
  quantityLoaded: number;
  quantityRemaining: number;
  /**
   * `YYYY-MM-DD` of the most recent order carrying this product, within the
   * window if one was given. A product row rolls up every line for that
   * product, so this is the latest of their DOC_DATEs rather than "the"
   * order date.
   */
  lastOrderDate: string | null;
}

/**
 * A customer's stock position as the customer LISTS report it.
 *
 * The same three figures the per-customer breakdown calls
 * totalPurchasedCartons / totalLoadedCartons / totalRemainingCartons, named
 * as the list columns name them.
 */
export interface CustomerStock {
  /** Cartons ordered on open, approved orders. */
  totalStock: number;
  /** Cartons already delivered against them. */
  stockLoaded: number;
  /** What is still to collect: totalStock - stockLoaded, floored at zero. */
  stockBalanceCartons: number;
}

/** One aggregate row as either stock-balance query returns it. */
export interface StockAggregateRow {
  product: string | null;
  ordered_qty: string | number | null;
  delivered_qty: string | number | null;
  item_code: string | null;
  item_specification: string | null;
  last_order_date: string | null;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly itemCodes: ErpItemCodeService,
  ) {}

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
      const rows = await this.prisma.$queryRawUnsafe<StockAggregateRow[]>(
        ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL,
        erpId,
        range?.startDate ?? null,
        range?.endDate ?? null,
      );

      // No rows at all means the ERP has no order history we can tie to this
      // customer — treat it as "unknown", not "nothing".
      if (rows.length === 0) return null;

      return this.shape(rows);
    } catch (e) {
      this.logger.error(
        `getStockBalance(${erpId}) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * The same stock position across MANY distributors - an account officer's
   * portfolio, or every distributor for an administrator.
   *
   * Products are grouped ACROSS the customers, so a product two distributors
   * both hold appears once with their quantities added. That is what a
   * portfolio-level "what is still to collect" figure means; the per-customer
   * split is what GET /officers/customers/{id}/stock is for.
   *
   * Returns null on an empty portfolio or an absent feed, exactly as the
   * single-customer form does, so callers keep one "we cannot say" branch.
   */
  async getStockBalanceForCustomers(
    erpIds: string[],
    range?: ErpStockDateRange,
  ): Promise<ErpStockBalance | null> {
    const codes = erpIds.filter((id) => !!id);
    if (codes.length === 0) return null;
    if (!(await this.isAvailable())) return null;
    try {
      // Codes -> the ERP's internal ids as its own step, so the aggregate can
      // filter on the INDEXED CUSTOMER_ID column with an explicit list.
      // Measured live: ~1.2s this way against ~6.2s for the subquery form.
      const ids = await this.prisma.$queryRawUnsafe<
        { id: string | null; code: string | null }[]
      >(ERP_CUSTOMER_IDS_FOR_CODES_SQL, codes.join(','));
      const customerIds = ids
        .map((r) => r.id)
        .filter((id): id is string => !!id);
      if (customerIds.length === 0) return null;

      const rows = await this.prisma.$queryRawUnsafe<StockAggregateRow[]>(
        ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL,
        customerIds.join(','),
        range?.startDate ?? null,
        range?.endDate ?? null,
      );
      if (rows.length === 0) return null;
      return this.shape(rows);
    } catch (e) {
      this.logger.error(
        `getStockBalanceForCustomers(${codes.length} customers) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * The ERP item code for one aggregate row, from the best source available.
   *
   * THREE SOURCES, in order of authority:
   *
   *  1. the rows themselves - the code the ERP stated on this very product's
   *     lines, when it stated one;
   *  2. the feed-wide map - the code the ERP states for this product name
   *     ANYWHERE, because it carries ITEM_CODE on only 5.7% of line rows and
   *     a customer's own orders often miss all of them;
   *  3. the Viju product specification sheet, for the 58 products the feed
   *     never codes at all.
   *
   * The ERP wins over the sheet where they disagree - which they do for 5
   * products - because the ERP is the system of record for its own codes.
   *
   * Still null for the 33 products neither source names: packaging film,
   * water-pump dispensers, biscuit freight. Nothing is invented to fill them.
   */
  private resolveItemCode(
    row: StockAggregateRow,
    productName: string,
  ): string | null {
    if (row.item_code) return row.item_code;
    const feedWide = this.itemCodes.codeFor(row.product);
    if (feedWide) return feedWide;
    return resolveProduct(productName, row.item_specification).productId;
  }

  /**
   * One customer's stock position, for the customer LISTS.
   *
   * The same three figures the per-customer breakdown reports as
   * `totalPurchasedCartons` / `totalLoadedCartons` / `totalRemainingCartons`,
   * named as the list columns name them.
   */
  /**
   * Stock per customer, keyed by CUSTOMER_CODE (`erpId`).
   *
   * For the STOCK column on the admin and officer customer lists: one query
   * for a whole page, and the same formula and filters the distributor's own
   * screen uses, so a page of 200 costs the same as a page of 20 and cannot
   * show a different number.
   *
   * A customer the ERP has no open, approved orders for is ABSENT from the
   * map rather than present as 0 - the caller has to decide whether that
   * means "nothing outstanding" or "we could not say", and for the lists it
   * means falling back to the local projection.
   */
  async stockByErpId(erpIds: string[]): Promise<Map<string, CustomerStock>> {
    const empty = new Map<string, CustomerStock>();
    const codes = [...new Set(erpIds.filter((id) => !!id))];
    if (codes.length === 0) return empty;
    if (!(await this.isAvailable())) return empty;
    try {
      const ids = await this.prisma.$queryRawUnsafe<
        { id: string | null; code: string | null }[]
      >(ERP_CUSTOMER_IDS_FOR_CODES_SQL, codes.join(','));
      // The aggregate groups by the ERP's internal id; the caller knows only
      // the code, so keep the way back.
      const codeById = new Map<string, string>();
      for (const row of ids) {
        if (row.id && row.code) codeById.set(row.id, row.code);
      }
      if (codeById.size === 0) return empty;

      const rows = await this.prisma.$queryRawUnsafe<
        {
          customer_id: string | null;
          ordered_qty: string | number | null;
          delivered_qty: string | number | null;
        }[]
      >(ERP_STOCK_REMAINING_BY_CUSTOMER_SQL, [...codeById.keys()].join(','));

      const num = (v: string | number | null): number => {
        const parsed = Number(v ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const stock = new Map<string, CustomerStock>();
      for (const row of rows) {
        const code = row.customer_id ? codeById.get(row.customer_id) : null;
        if (!code) continue;
        const totalStock = num(row.ordered_qty);
        const stockLoaded = num(row.delivered_qty);
        stock.set(code, {
          totalStock,
          stockLoaded,
          // Floored per customer, as the totals are: the feed carries a few
          // lines delivered above what was ordered.
          stockBalanceCartons: Math.max(0, totalStock - stockLoaded),
        });
      }
      return stock;
    } catch (e) {
      this.logger.error(
        `stockByErpId(${codes.length} customers) failed: ${(e as Error).message}. ` +
          'The caller falls back to the locally projected figure.',
      );
      return empty;
    }
  }

  /**
   * Turns aggregate rows into the balance. Shared by the single-customer and
   * the portfolio query so the two can never shape, floor or sort differently.
   */
  private shape(rows: StockAggregateRow[]): ErpStockBalance {
    const num = (v: string | number | null): number => {
      const parsed = Number(v ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const products = rows.map((r) => {
      const quantityPaid = num(r.ordered_qty);
      const quantityLoaded = num(r.delivered_qty);
      const productName = r.product ?? 'Unspecified';
      return {
        itemCode: this.resolveItemCode(r, productName),
        productName,
        spec: stripCjk(r.item_specification),
        quantityPaid,
        quantityLoaded,
        // Floored per product so a single over-delivered line cannot show a
        // negative quantity against a product on screen.
        quantityRemaining: Math.max(0, quantityPaid - quantityLoaded),
        lastOrderDate: r.last_order_date ?? null,
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
      // Derived from the totals, not from the floored per-product rows, so it
      // stays exactly purchased - loaded. Floored at zero: the feed carries a
      // handful of lines delivered above what was ordered.
      totalRemainingCartons: Math.max(
        0,
        totalPurchasedCartons - totalLoadedCartons,
      ),
      products,
    };
  }
}
