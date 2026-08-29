import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ERP_WAYBILLS_COUNT_SQL, ERP_WAYBILLS_PAGE_SQL } from './erp-waybills';
import {
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  PaginatedResponse,
} from '../../common/pagination/paginate';

/** One ERP goods-movement document. */
export interface ErpWaybill {
  docNo: string;
  docDate: string | null;
  orderDate: string | null;
  shipTo: string | null;
  lines: number;
  products: number;
  quantityOrdered: number;
  quantityDelivered: number;
  quantityRemaining: number;
  status: string;
  lastChangedAt: Date | null;
}

/**
 * The ERP's own goods-movement records for one distributor, read live from
 * `erp_raw.raw_sales_order` and rolled up to one row per document.
 */
@Injectable()
export class ErpWaybillsService {
  private readonly logger = new Logger(ErpWaybillsService.name);
  private available: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

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
   * One page of ERP documents for `erpId` (CUSTOMER_CODE), newest first.
   *
   * An absent feed, an unknown customer or a query failure all return an empty
   * page with a valid `meta` - a list screen degrades to "nothing to show"
   * rather than erroring.
   */
  async list(
    erpId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ): Promise<PaginatedResponse<ErpWaybill>> {
    const page = Math.max(1, Math.floor(pagination.page || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(pagination.pageSize || 20)),
    );
    const empty = { data: [], meta: buildPaginationMeta(0, page, pageSize) };
    if (!erpId) return empty;
    if (!(await this.isAvailable())) return empty;

    try {
      const [counted, rows] = await Promise.all([
        this.prisma.$queryRawUnsafe<{ n: number }[]>(
          ERP_WAYBILLS_COUNT_SQL,
          erpId,
        ),
        this.prisma.$queryRawUnsafe<
          {
            doc_no: string;
            doc_date: string | null;
            order_date: string | null;
            ship_to: string | null;
            lines: number;
            products: number;
            ordered_qty: string | number | null;
            delivered_qty: string | number | null;
            status: string;
            changed_at: Date | null;
          }[]
        >(ERP_WAYBILLS_PAGE_SQL, erpId, pageSize, (page - 1) * pageSize),
      ]);

      const num = (v: string | number | null): number => {
        const parsed = Number(v ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      return {
        data: rows.map((r) => {
          const quantityOrdered = num(r.ordered_qty);
          const quantityDelivered = num(r.delivered_qty);
          return {
            docNo: r.doc_no,
            docDate: r.doc_date,
            orderDate: r.order_date,
            shipTo: r.ship_to,
            lines: r.lines,
            products: r.products,
            quantityOrdered,
            quantityDelivered,
            // Floored: a handful of feed lines carry delivered above ordered.
            quantityRemaining: Math.max(0, quantityOrdered - quantityDelivered),
            status: r.status,
            lastChangedAt: r.changed_at,
          };
        }),
        meta: buildPaginationMeta(counted[0]?.n ?? 0, page, pageSize),
      };
    } catch (e) {
      this.logger.error(`list(${erpId}) failed: ${(e as Error).message}`);
      return empty;
    }
  }
}
