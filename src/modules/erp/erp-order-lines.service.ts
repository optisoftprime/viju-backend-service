import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ERP_ORDER_LINES_SQL } from './order-lines';

/** One line of an order, as the ERP states it. */
export interface ErpOrderLine {
  id: string;
  productName: string;
  itemCode: string | null;
  quantity: number;
  /** Null: the feed carries no per-line price. See order-lines.ts. */
  unitPrice: number | null;
  /** Null: the feed carries no per-line amount. See order-lines.ts. */
  lineTotal: number | null;
}

/**
 * Order line items read live from the ERP sales-order feed, for the orders the
 * projector has not copied lines for (10,320 of 10,350 today).
 */
@Injectable()
export class ErpOrderLinesService {
  private readonly logger = new Logger(ErpOrderLinesService.name);
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
    } catch (e) {
      this.available = false;
      this.logger.error(
        `Could not probe erp_raw.raw_sales_order: ${(e as Error).message}. Treating it as absent.`,
      );
    }
    return this.available;
  }

  /**
   * Lines for a set of orders, keyed by DOC_NO (`Purchase.erpId`).
   *
   * An order the feed knows nothing about is simply absent from the map, so a
   * caller falls back to whatever the projector copied rather than replacing
   * real local lines with an empty list.
   */
  async getLinesByOrder(
    erpIds: string[],
  ): Promise<Map<string, ErpOrderLine[]>> {
    const ids = [...new Set(erpIds.filter((id) => !!id))];
    if (ids.length === 0) return new Map();
    if (!(await this.isAvailable())) return new Map();
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        {
          doc_no: string;
          product_name: string | null;
          item_code: string | null;
          quantity: string | number | null;
          row_id: string | number;
        }[]
      >(ERP_ORDER_LINES_SQL, ids);

      const byOrder = new Map<string, ErpOrderLine[]>();
      for (const r of rows) {
        const qty = Number(r.quantity ?? 0);
        const line: ErpOrderLine = {
          id: String(r.row_id),
          productName: r.product_name ?? 'Unspecified',
          itemCode: r.item_code ?? null,
          quantity: Number.isFinite(qty) ? qty : 0,
          unitPrice: null,
          lineTotal: null,
        };
        const bucket = byOrder.get(r.doc_no) ?? [];
        bucket.push(line);
        byOrder.set(r.doc_no, bucket);
      }
      return byOrder;
    } catch (e) {
      this.logger.error(
        `getLinesByOrder(${ids.length} orders) failed: ${(e as Error).message}`,
      );
      return new Map();
    }
  }

  /** Lines for one order. Empty when the feed holds none. */
  async getLines(erpId: string): Promise<ErpOrderLine[]> {
    return (await this.getLinesByOrder([erpId])).get(erpId) ?? [];
  }
}
