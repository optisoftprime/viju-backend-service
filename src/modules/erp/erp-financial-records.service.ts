import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  FinancialRecordConfig,
  financialRecordDetailSql,
  financialRecordsCountSql,
  financialRecordsPageSql,
} from './erp-financial-records';
import {
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  PaginatedResponse,
} from '../../common/pagination/paginate';

/**
 * One financial document, in the shape the API returns it.
 *
 * `amounts` is an open map rather than fixed fields because the three ledgers
 * carry different money columns — a collection has no refund amount and a
 * refund has no settlement expense. Each entry holds the ERP's `fc` and `tc`
 * figures, both nullable: the feed leaves plenty of them empty and a missing
 * amount must read as "not stated", never as zero.
 */
export interface ErpFinancialRecord {
  docNo: string;
  docDate: string | null;
  bookkeepingDate: string | null;
  customerCode: string | null;
  customerName: string | null;
  approveStatus: string | null;
  approveDate: string | null;
  remark: string | null;
  exchangeRate: number | null;
  amounts: Record<string, { fc: number | null; tc: number | null }>;
  lastChangedAt: Date | null;
}

/**
 * The ERP's customer-facing financial ledgers — collections, AR refunds and
 * other receivables — read live from `erp_raw`.
 *
 * One service for all three: they share a document skeleton and differ only in
 * which money columns they carry, which the config in `erp-financial-records`
 * describes. See that file for the scoping and FC/TC reasoning.
 */
@Injectable()
export class ErpFinancialRecordsService {
  private readonly logger = new Logger(ErpFinancialRecordsService.name);

  /** Per-table availability probe, cached after the first check. */
  private readonly available = new Map<string, boolean>();

  constructor(private readonly prisma: PrismaService) {}

  /** True when this database carries the named `erp_raw` table. */
  async isAvailable(config: FinancialRecordConfig): Promise<boolean> {
    const cached = this.available.get(config.table);
    if (cached !== undefined) return cached;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.${config.table}') IS NOT NULL AS present`,
      );
      const present = rows[0]?.present === true;
      this.available.set(config.table, present);
      if (!present) {
        this.logger.warn(
          `erp_raw.${config.table} not found — ${config.label} records are ` +
            'unavailable. Expected on a database without the ERP feed.',
        );
      }
      return present;
    } catch (e) {
      this.available.set(config.table, false);
      this.logger.error(
        `Could not probe erp_raw.${config.table}: ${(e as Error).message}. Treating it as absent.`,
      );
      return false;
    }
  }

  /**
   * One page for a customer, newest first.
   *
   * An absent feed, an unknown customer or a query failure all return an empty
   * page with a valid `meta` — a list screen degrades to "nothing to show"
   * rather than erroring.
   */
  async list(
    config: FinancialRecordConfig,
    erpId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ): Promise<PaginatedResponse<ErpFinancialRecord>> {
    const page = Math.max(1, Math.floor(pagination.page || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(pagination.pageSize || 20)),
    );
    const empty = { data: [], meta: buildPaginationMeta(0, page, pageSize) };
    if (!erpId) return empty;
    if (!(await this.isAvailable(config))) return empty;

    try {
      const [counted, rows] = await Promise.all([
        this.prisma.$queryRawUnsafe<{ n: number }[]>(
          financialRecordsCountSql(config),
          erpId,
        ),
        this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          financialRecordsPageSql(config),
          erpId,
          pageSize,
          (page - 1) * pageSize,
        ),
      ]);

      return {
        data: rows.map((r) => this.toRecord(config, r)),
        meta: buildPaginationMeta(counted[0]?.n ?? 0, page, pageSize),
      };
    } catch (e) {
      this.logger.error(
        `list(${config.slug}, ${erpId}) failed: ${(e as Error).message}`,
      );
      return empty;
    }
  }

  /** One document, or null when this customer has no such document. */
  async detail(
    config: FinancialRecordConfig,
    erpId: string,
    docNo: string,
  ): Promise<ErpFinancialRecord | null> {
    if (!erpId || !docNo) return null;
    if (!(await this.isAvailable(config))) return null;
    try {
      const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        financialRecordDetailSql(config),
        erpId,
        docNo,
      );
      return rows.length ? this.toRecord(config, rows[0]) : null;
    } catch (e) {
      this.logger.error(
        `detail(${config.slug}, ${erpId}, ${docNo}) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  private toRecord(
    config: FinancialRecordConfig,
    row: Record<string, unknown>,
  ): ErpFinancialRecord {
    // Every one of these columns is a `payload->>` extraction, which Postgres
    // returns as text. Narrowing on that rather than stringifying `unknown`
    // keeps a surprise object from serialising as '[object Object]'.
    const text = (v: unknown): string | null =>
      typeof v === 'string' ? v : null;

    // Null, never 0: the feed leaves many of these empty and a silent column
    // must not read as a real zero amount.
    const money = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const amounts: ErpFinancialRecord['amounts'] = {};
    for (const a of config.amounts) {
      const key = a.name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      amounts[a.name] = {
        fc: money(row[`${key}_fc`]),
        tc: money(row[`${key}_tc`]),
      };
    }

    return {
      docNo: text(row.doc_no) ?? '',
      docDate: text(row.doc_date),
      bookkeepingDate: text(row.bookkeeping_date),
      customerCode: text(row.customer_code),
      customerName: text(row.customer_name),
      approveStatus: text(row.approve_status),
      approveDate: text(row.approve_date),
      remark: text(row.remark),
      exchangeRate: money(row.exchange_rate),
      amounts,
      lastChangedAt: (row.changed_at as Date | null) ?? null,
    };
  }
}
