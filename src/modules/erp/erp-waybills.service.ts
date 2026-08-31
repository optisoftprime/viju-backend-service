import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ERP_WAYBILLS_COUNT_SQL,
  ERP_WAYBILLS_PAGE_SQL,
  ERP_WAYBILL_DETAIL_SQL,
  ERP_WAYBILL_ITEMS_SQL,
} from './erp-waybills';
import { stripCjk } from './strip-cjk';
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
  /** ERP QTY_TOTAL - a document-level figure, not a sum of the lines. */
  quantity: number | null;
  /** Sum of the lines' AMOUNT. Null when no line carries one. */
  totalAmountBeforeTax: number | null;
  /** Sum of each line's AMOUNT x TAX_RATE. Null when no line carries money. */
  taxVat: number | null;
  /** totalAmountBeforeTax + taxVat. Null when no line carries money. */
  totalAmountAfterTax: number | null;
  status: string;
  lastChangedAt: Date | null;
}

/** One item line of an ERP goods-movement document. */
export interface ErpWaybillItem {
  id: string;
  itemCode: string | null;
  description: string | null;
  /** ITEM_SPECIFICATION with the ERP's Chinese category characters removed. */
  specification: string | null;
  price: number | null;
  /** BUSINESS_QTY - this line's own quantity. */
  quantity: number;
  quantityDelivered: number;
  quantityRemaining: number;
  totalAmountBeforeTax: number | null;
  taxVat: number | null;
  totalAmountAfterTax: number | null;
  /** The decimal rate the tax was derived from, e.g. 0.075. */
  taxRate: number | null;
}

/** A document with its item lines. */
export interface ErpWaybillDetail extends ErpWaybill {
  items: ErpWaybillItem[];
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
            qty_total: string | number | null;
            amount_before_tax: string | number | null;
            tax_vat: string | number | null;
            status: string;
            changed_at: Date | null;
          }[]
        >(ERP_WAYBILLS_PAGE_SQL, erpId, pageSize, (page - 1) * pageSize),
      ]);

      return {
        data: rows.map((r) => toWaybill(r)),
        meta: buildPaginationMeta(counted[0]?.n ?? 0, page, pageSize),
      };
    } catch (e) {
      this.logger.error(`list(${erpId}) failed: ${(e as Error).message}`);
      return empty;
    }
  }

  /**
   * One document with its item lines, or null when this customer has no such
   * document.
   *
   * The customer code is part of BOTH queries' predicates, so a distributor
   * cannot read another's waybill by guessing a DOC_NO - it comes back as a
   * plain not-found rather than a leak.
   */
  async detail(erpId: string, docNo: string): Promise<ErpWaybillDetail | null> {
    if (!erpId || !docNo) return null;
    if (!(await this.isAvailable())) return null;

    try {
      const [head, items] = await Promise.all([
        this.prisma.$queryRawUnsafe<WaybillRow[]>(
          ERP_WAYBILL_DETAIL_SQL,
          erpId,
          docNo,
        ),
        this.prisma.$queryRawUnsafe<WaybillItemRow[]>(
          ERP_WAYBILL_ITEMS_SQL,
          erpId,
          docNo,
        ),
      ]);
      if (head.length === 0) return null;

      return {
        ...toWaybill(head[0]),
        items: items.map((r) => {
          const quantity = num(r.business_qty);
          const quantityDelivered = num(r.delivered_qty);
          const before = money(r.amount_before_tax);
          const tax = money(r.tax_vat);
          return {
            id: String(r.row_id),
            itemCode: r.item_code ?? null,
            description: r.description ?? null,
            specification: stripCjk(r.specification),
            price: money(r.price),
            quantity,
            quantityDelivered,
            quantityRemaining: Math.max(0, quantity - quantityDelivered),
            totalAmountBeforeTax: before,
            taxVat: tax,
            totalAmountAfterTax: addMoney(before, tax),
            taxRate: money(r.tax_rate),
          };
        }),
      };
    } catch (e) {
      this.logger.error(
        `detail(${erpId}, ${docNo}) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }
}

interface WaybillRow {
  doc_no: string;
  doc_date: string | null;
  order_date: string | null;
  ship_to: string | null;
  lines: number;
  products: number;
  ordered_qty: string | number | null;
  delivered_qty: string | number | null;
  qty_total: string | number | null;
  amount_before_tax: string | number | null;
  tax_vat: string | number | null;
  status: string;
  changed_at: Date | null;
}

interface WaybillItemRow {
  item_code: string | null;
  description: string | null;
  specification: string | null;
  price: string | number | null;
  amount_before_tax: string | number | null;
  tax_vat: string | number | null;
  tax_rate: string | number | null;
  business_qty: string | number | null;
  qty_total: string | number | null;
  delivered_qty: string | number | null;
  row_id: string | number;
}

/** Quantities: absent means zero. */
function num(v: string | number | null): number {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Money: absent means NULL, never 0. The ERP carries per-line money on only
 * 5.7% of rows, and reporting a silent line as zero would read as "this cost
 * nothing" rather than "the ERP did not say".
 */
function money(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Null unless at least one side is known, so 0 never masquerades as a total. */
function addMoney(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function toWaybill(r: WaybillRow): ErpWaybill {
  const quantityOrdered = num(r.ordered_qty);
  const quantityDelivered = num(r.delivered_qty);
  const before = money(r.amount_before_tax);
  const tax = money(r.tax_vat);
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
    quantity: money(r.qty_total),
    totalAmountBeforeTax: before,
    taxVat: tax,
    totalAmountAfterTax: addMoney(before, tax),
    status: r.status,
    lastChangedAt: r.changed_at,
  };
}
