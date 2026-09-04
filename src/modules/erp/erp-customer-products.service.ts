import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { resolveProduct } from './product-specification.resolver';
import { stripCjk } from './strip-cjk';
import { ErpItemCodeService } from './erp-item-code.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';

/**
 * A product on one order: what the specification sheet knows about it, plus
 * how much of it is still to collect ON THAT ORDER.
 */
export interface ErpOrderProduct {
  productId: string | null;
  productName: string;
  /**
   * ITEM_SPECIFICATION, with the ERP's Chinese category characters stripped -
   * '750ML(L)' from '750ML(L)', '100ML' from '100ML中性'. It is what separates
   * two products the feed gives the same name, so it belongs on screen next to
   * the name.
   */
  spec: string | null;
  weightPerCarton: number | null;
  /** BUSINESS_QTY1 - DELIVERED_BUSINESS_QTY, summed over the order's lines. */
  quantityLeft: number;
}

/**
 * The products on ONE sales order, as the ERP records them, each carried
 * through the Viju product specification sheet for its item code and carton
 * weight.
 *
 * ─── Which id ───────────────────────────────────────────────────────────
 *
 * Keyed on the order, not the customer. The identifier is the one
 * `linkedPurchaseId` carries on GET /customers/me/waybills - a `Purchase.id`
 * uuid - so a distributor holding a loading request can ask what is on the
 * order it is against. `Purchase.erpId` (the ERP DOC_NO) is accepted too, so
 * a caller holding either identifier works.
 *
 * `Purchase.erpId` IS the feed's DOC_NO, so no id bridge is needed once the
 * purchase is resolved.
 */
@Injectable()
export class ErpCustomerProductsService {
  private readonly logger = new Logger(ErpCustomerProductsService.name);
  private available: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly itemCodes: ErpItemCodeService,
    private readonly stockBalance: ErpStockBalanceService,
  ) {}

  /**
   * Everything ONE DISTRIBUTOR still has to collect, product by product.
   *
   * This is the picker behind a loading request. A request is filed against
   * the ACCOUNT rather than a single order, so the products it may draw on are
   * the distributor's whole outstanding stock, not one document's lines.
   *
   * ─── The same figures the distributor's own screen shows ──────────────
   *
   * `quantityLeft` comes from the stock-balance query, not a second one of its
   * own: SUM(BUSINESS_QTY1 - DELIVERED_BUSINESS_QTY) over OPEN, APPROVED
   * orders. So the picker and GET /customers/me/stock-balance cannot disagree
   * about how much of a product is outstanding - which they would within a
   * day if this counted it differently.
   *
   * Only products with something still to collect appear: a product taken in
   * full is not something a truck can be loaded with.
   *
   * `id` may be the local `Customer.id` uuid or the ERP CUSTOMER_CODE; both
   * identify one distributor.
   *
   * Returns [] - never an error - for an unknown distributor or an absent
   * feed, so a picker renders empty rather than breaking.
   */
  async listForCustomer(
    id: string,
    requesterId?: string,
  ): Promise<ErpOrderProduct[]> {
    if (!id) return [];
    const customer = await this.prisma.customer.findFirst({
      where: { OR: [{ id }, { erpId: id }] },
      select: { id: true, erpId: true },
    });
    if (!customer) return [];
    // A distributor is pinned to their own stock. `requesterId` is set only
    // for a CUSTOMER caller, and naming anyone else reads as empty rather
    // than being obeyed - the id in the path never widens what a token can
    // see. Their own erpId names them just as well as their uuid.
    if (requesterId && customer.id !== requesterId) return [];

    const balance = await this.stockBalance.getStockBalance(customer.erpId);
    if (!balance) return [];

    return balance.products
      .filter((product) => product.quantityRemaining > 0)
      .map((product) => {
        // The carton weight is the specification sheet's, matched on the same
        // name and spec the stock query grouped by.
        const resolved = resolveProduct(product.productName, product.spec);
        return {
          productId: product.itemCode ?? resolved.productId,
          productName: product.productName,
          spec: product.spec,
          weightPerCarton: resolved.weightPerCarton,
          quantityLeft: product.quantityRemaining,
        };
      });
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_sales_order') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
    } catch (e) {
      // NOT cached: a probe that THREW tells us nothing about whether the
      // table exists - it is almost always the database being briefly
      // unreachable (P1017 on a dropped connection, a restart, a network
      // blip). Caching `false` here disabled the ERP feed for the whole
      // life of the process after one blip at boot, silently degrading
      // every screen that reads it. Leaving it unset means the next call
      // probes again.
      this.logger.error(
        `Could not probe erp_raw.raw_sales_order: ${(e as Error).message}. ` +
          'Treating the feed as unavailable for this call only; will retry.',
      );
      return false;
    }
    return this.available;
  }
}
