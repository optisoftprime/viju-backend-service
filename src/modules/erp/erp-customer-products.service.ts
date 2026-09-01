import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { resolveProduct } from './product-specification.resolver';
import { ErpItemCodeService } from './erp-item-code.service';

/**
 * A product on one order: what the specification sheet knows about it, plus
 * how much of it is still to collect ON THAT ORDER.
 */
export interface ErpOrderProduct {
  productId: string | null;
  productName: string;
  weightPerCarton: number | null;
  /** BUSINESS_QTY - DELIVERED_BUSINESS_QTY, summed over the order's lines. */
  quantityLeft: number;
  matchedOn: 'SPEC_AND_NAME' | 'NAME' | 'SPEC' | 'NONE';
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
  ) {}

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_sales_order') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
    } catch (e) {
      this.available = false;
      this.logger.error(
        `Could not probe erp_raw.raw_sales_order: ${(e as Error).message}. Treating it as absent.`,
      );
    }
    return this.available;
  }

  /**
   * Resolves the order to its ERP DOC_NO.
   *
   * `orderId` may be a `Purchase.id` uuid (what `linkedPurchaseId` carries) or
   * the DOC_NO itself. When `customerId` is given the order must belong to
   * that customer, so a distributor cannot read another's order by id.
   *
   * Returns null when the order is unknown, or is not the caller's.
   */
  private async resolveDocNo(
    orderId: string,
    customerId?: string,
  ): Promise<string | null> {
    const purchase = await this.prisma.purchase.findFirst({
      where: {
        OR: [{ id: orderId }, { erpId: orderId }],
        ...(customerId ? { customerId } : {}),
      },
      select: { erpId: true },
    });
    if (purchase) return purchase.erpId;
    // A DOC_NO the projector has never copied into `Purchase` is still a real
    // ERP order, so staff may still read it. A customer may not: without a
    // local row there is nothing that proves it is theirs.
    return customerId ? null : orderId;
  }

  /**
   * One entry per DISTINCT product on the order.
   *
   * The feed holds a row per order LINE, so an order with several lines of the
   * same product collapses to one entry.
   *
   * Returns [] - never an error - when the feed is absent, the order is
   * unknown, or the order is not this customer's, so a picker renders empty
   * rather than breaking.
   */
  async listForOrder(
    orderId: string,
    customerId?: string,
  ): Promise<ErpOrderProduct[]> {
    if (!orderId) return [];
    if (!(await this.isAvailable())) return [];
    try {
      const docNo = await this.resolveDocNo(orderId, customerId);
      if (!docNo) return [];

      const rows = await this.prisma.$queryRawUnsafe<
        {
          descr: string | null;
          spec: string | null;
          item_code: string | null;
          ordered_qty: string | number | null;
          delivered_qty: string | number | null;
        }[]
      >(
        // Aggregated rather than DISTINCT: the feed holds a row per order
        // LINE, and `quantityLeft` has to be the sum across every line of the
        // product on this order, not one line's share of it.
        `SELECT so.payload->>'ITEM_DESCRIPTION'   AS descr,
                so.payload->>'ITEM_SPECIFICATION' AS spec,
                min(nullif(so.payload->>'ITEM_CODE', '')) AS item_code,
                sum(coalesce(nullif(so.payload->>'BUSINESS_QTY', '')::numeric, 0))
                  AS ordered_qty,
                sum(coalesce(nullif(so.payload->>'DELIVERED_BUSINESS_QTY', '')::numeric, 0))
                  AS delivered_qty
           FROM erp_raw.raw_sales_order so
          WHERE so.object_type = 'SALES_ORDER'
            AND so.payload->>'DOC_NO' = $1
          GROUP BY 1, 2
          ORDER BY 1`,
        docNo,
      );

      // One product can arrive under two specifications that resolve to the
      // same code and weight - '(1.5)MALT MILK(O)' under both 500ML果汁(O) and
      // 500ML麦汁(O). Those rows are indistinguishable once resolved, so they
      // would read as a duplicated product on screen.
      const num = (v: string | number | null): number => {
        const parsed = Number(v ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const byKey = new Map<string, ErpOrderProduct>();
      for (const row of rows) {
        if ((row.descr ?? '').trim() === '') continue;
        const resolved = resolveProduct(row.descr, row.spec);
        // The ERP's own code first, then the sheet's: the feed is the system
        // of record for its codes, and states one on only ~6% of line rows.
        const productId =
          row.item_code ??
          this.itemCodes.codeFor(row.descr) ??
          resolved.productId;
        const key = `${productId ?? ''}|${resolved.productName}|${resolved.weightPerCarton ?? ''}`;
        // Two specifications can resolve to the same product - '(1.5)MALT
        // MILK(O)' arrives under both 500ML果汁(O) and 500ML麦汁(O). They are
        // one product on screen, so their quantities are ADDED rather than
        // one row being dropped.
        const seen = byKey.get(key);
        const left = Math.max(0, num(row.ordered_qty) - num(row.delivered_qty));
        if (seen) {
          seen.quantityLeft += left;
          continue;
        }
        byKey.set(key, { ...resolved, productId, quantityLeft: left });
      }
      return [...byKey.values()];
    } catch (e) {
      this.logger.error(
        `listForOrder(${orderId}) failed: ${(e as Error).message}`,
      );
      return [];
    }
  }
}
