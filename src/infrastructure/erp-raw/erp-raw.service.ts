import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  BP_CLUSTER_CODE_VALUES,
  Region,
  tryRegionFromBpClusterCode,
} from '../../common/region/region.constants';
import {
  ErpCustomerCounts,
  ErpCustomerDetail,
  ErpSyncStatus,
  ErpUnmappedCustomer,
} from './erp-raw.types';

/**
 * Read-only window onto the `erp_raw` schema.
 *
 * The ERP ingest writes raw objects into `erp_raw.raw_*`, and a separate
 * projector copies them into the application tables. NEITHER JOB LIVES IN THIS
 * SERVICE — this class only reads, so the portal can answer "how many
 * customers does the ERP actually have?" instead of reporting how many have
 * been projected so far.
 *
 * The schema is optional: a fresh database (CI, a new local environment) has
 * no `erp_raw`. Every method degrades to nulls/zeros in that case rather than
 * throwing, so the portal keeps working without the feed.
 */
@Injectable()
export class ErpRawService {
  private readonly logger = new Logger('ErpRawService');
  /** Cached availability probe; null until first checked. */
  private available: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True when the ERP landing schema is present in this database. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_customer') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
      if (!this.available) {
        this.logger.warn(
          'erp_raw schema not found — ERP reconciliation counts will be null. ' +
            'This is expected on a database without the ERP feed.',
        );
      }
    } catch (e) {
      this.available = false;
      this.logger.error(
        `Could not probe erp_raw: ${(e as Error).message}. Treating it as absent.`,
      );
    }
    return this.available;
  }

  /**
   * Freshness per ingest/projection job, newest run first.
   *
   * `lastSyncAt` is the most recent SUCCESSFUL finish across all jobs — what
   * the dashboard shows so staleness is visible even when a job is failing.
   */
  async getSyncStatus(): Promise<ErpSyncStatus> {
    if (!(await this.isAvailable())) return { lastSyncAt: null, jobs: [] };
    try {
      const jobs = await this.prisma.$queryRawUnsafe<
        {
          job: string;
          status: string;
          finished_at: Date | null;
          rows_fetched: number | null;
          rows_projected: number | null;
        }[]
      >(
        `SELECT DISTINCT ON (job) job, status, finished_at, rows_fetched, rows_projected
           FROM erp_raw.sync_run
          ORDER BY job, id DESC`,
      );
      const last = await this.prisma.$queryRawUnsafe<{ last: Date | null }[]>(
        `SELECT max(finished_at) AS last FROM erp_raw.sync_run WHERE status = 'SUCCESS'`,
      );
      return {
        lastSyncAt: last[0]?.last ?? null,
        jobs: jobs.map((j) => ({
          job: j.job,
          status: j.status,
          lastFinishedAt: j.finished_at,
          rowsFetched: j.rows_fetched,
          rowsProjected: j.rows_projected,
        })),
      };
    } catch (e) {
      this.logger.error(`getSyncStatus failed: ${(e as Error).message}`);
      return { lastSyncAt: null, jobs: [] };
    }
  }

  /**
   * Customer counts as the ERP sees them.
   *
   * The feed is shared with other tenants: rows carry a BP_CLUSTER_CODE, and
   * only codes 1-5 are Viju's Nigerian regions. Anything else (other-tenant
   * codes, blanks) is counted as unmapped rather than silently inflating the
   * distributor count — that count is surfaced so the mismatch is visible
   * instead of hidden.
   */
  async getCustomerCounts(): Promise<ErpCustomerCounts> {
    const empty: ErpCustomerCounts = {
      erpTotal: 0,
      vijuTotal: 0,
      unmappedRegionCount: 0,
      byRegion: {},
      lastSyncAt: null,
    };
    if (!(await this.isAvailable())) return empty;

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { code: string | null; n: number }[]
      >(
        `SELECT payload->>'BP_CLUSTER_CODE' AS code, count(*)::int AS n
           FROM erp_raw.raw_customer
          GROUP BY 1`,
      );
      const seen = await this.prisma.$queryRawUnsafe<{ last: Date | null }[]>(
        `SELECT max(last_seen_at) AS last FROM erp_raw.raw_customer`,
      );

      const counts: ErpCustomerCounts = {
        ...empty,
        lastSyncAt: seen[0]?.last ?? null,
        byRegion: {},
      };
      for (const row of rows) {
        counts.erpTotal += row.n;
        const region = tryRegionFromBpClusterCode(row.code);
        if (region === null) {
          counts.unmappedRegionCount += row.n;
          continue;
        }
        counts.vijuTotal += row.n;
        counts.byRegion[region] = (counts.byRegion[region] ?? 0) + row.n;
      }
      return counts;
    } catch (e) {
      this.logger.error(`getCustomerCounts failed: ${(e as Error).message}`);
      return empty;
    }
  }

  /**
   * The ERP rows whose region could not be mapped — the quarantine list.
   * Ops uses this to chase the ERP team; nothing here is treated as a Viju
   * distributor.
   */
  async listUnmappedCustomers(
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ): Promise<{ rows: ErpUnmappedCustomer[]; total: number }> {
    if (!(await this.isAvailable())) return { rows: [], total: 0 };

    // Built from the canonical code list so it cannot drift from region.constants.
    const mapped = BP_CLUSTER_CODE_VALUES.map((c) => `'${String(c)}'`).join(
      ',',
    );
    const where = `WHERE coalesce(payload->>'BP_CLUSTER_CODE', '') NOT IN (${mapped})`;
    const take = Math.min(200, Math.max(1, pagination.pageSize));
    const skip = (Math.max(1, pagination.page) - 1) * take;

    try {
      const [countRows, rows] = await Promise.all([
        this.prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM erp_raw.raw_customer ${where}`,
        ),
        this.prisma.$queryRawUnsafe<
          {
            erp_id: string | null;
            name: string | null;
            phone: string | null;
            code: string | null;
            cluster_name: string | null;
            last_seen_at: Date | null;
          }[]
        >(
          `SELECT payload->>'CUSTOMER_CODE'      AS erp_id,
                  payload->>'CUSTOMER_NAME'      AS name,
                  payload->>'PhoneNumber'        AS phone,
                  payload->>'BP_CLUSTER_CODE'    AS code,
                  payload->>'BP_CLUSTER_NAME'    AS cluster_name,
                  last_seen_at
             FROM erp_raw.raw_customer
             ${where}
            ORDER BY last_seen_at DESC NULLS LAST
            LIMIT ${take} OFFSET ${skip}`,
        ),
      ]);

      return {
        total: countRows[0]?.n ?? 0,
        rows: rows.map((r) => ({
          erpId: r.erp_id ?? '',
          name: r.name,
          phone: r.phone,
          bpClusterCode: r.code,
          bpClusterName: r.cluster_name,
          lastSeenAt: r.last_seen_at,
        })),
      };
    } catch (e) {
      this.logger.error(
        `listUnmappedCustomers failed: ${(e as Error).message}`,
      );
      return { rows: [], total: 0 };
    }
  }

  /**
   * ERP-side detail for one customer, keyed on CUSTOMER_CODE (our `erpId`).
   *
   * `address` is deliberately null: the ERP customer master carries no address
   * field. Delivery documents do hold a ship-to address, but resolving it means
   * an unindexed scan of ~370k jsonb rows (~1.4s, frequently empty), so it is
   * not worth blocking a detail screen on. It needs either an address on the
   * customer master or an index from the ingest team.
   */
  async getCustomerDetail(erpId: string): Promise<ErpCustomerDetail | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const rows = await this.prisma.$queryRaw<
        {
          erp_id: string | null;
          name: string | null;
          phone: string | null;
          code: string | null;
          last_seen_at: Date | null;
        }[]
      >`SELECT payload->>'CUSTOMER_CODE'   AS erp_id,
               payload->>'CUSTOMER_NAME'   AS name,
               payload->>'PhoneNumber'     AS phone,
               payload->>'BP_CLUSTER_CODE' AS code,
               last_seen_at
          FROM erp_raw.raw_customer
         WHERE payload->>'CUSTOMER_CODE' = ${erpId}
         ORDER BY last_seen_at DESC NULLS LAST
         LIMIT 1`;

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        erpId: row.erp_id ?? erpId,
        name: row.name,
        phone: row.phone,
        region: tryRegionFromBpClusterCode(row.code),
        bpClusterCode: row.code,
        creditLimit: await this.getCreditLimit(erpId),
        address: null,
        lastErpSyncAt: row.last_seen_at,
      };
    } catch (e) {
      this.logger.error(`getCustomerDetail failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Latest effective credit limit for a customer (CREDIT_AMT on the most
   * recent credit record). Null when the ERP holds none.
   */
  private async getCreditLimit(erpId: string): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ amt: string | null }[]>`
        SELECT payload->>'CREDIT_AMT' AS amt
          FROM erp_raw.raw_customer_credit
         WHERE payload->>'CUSTOMER_CODE' = ${erpId}
         ORDER BY payload->>'EFFECTIVE_DATE' DESC
         LIMIT 1`;
      const raw = rows[0]?.amt;
      if (raw === undefined || raw === null || raw.trim() === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (e) {
      this.logger.error(`getCreditLimit failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * When each of these customers was last seen in the ERP feed, keyed by
   * erpId (CUSTOMER_CODE).
   *
   * Read straight from the feed rather than stored on our Customer rows: the
   * projector that writes those rows lives in another service, so a local
   * column would only be as fresh as that job. The customer feed is small
   * (~4k rows), so this stays cheap for a page of results.
   */
  async getLastSeenByErpIds(erpIds: string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (erpIds.length === 0 || !(await this.isAvailable())) return out;
    try {
      const rows = await this.prisma.$queryRaw<
        { erp_id: string; last_seen_at: Date | null }[]
      >`SELECT payload->>'CUSTOMER_CODE' AS erp_id, max(last_seen_at) AS last_seen_at
          FROM erp_raw.raw_customer
         WHERE payload->>'CUSTOMER_CODE' = ANY(${erpIds})
         GROUP BY 1`;
      for (const row of rows) {
        if (row.last_seen_at) out.set(row.erp_id, row.last_seen_at);
      }
    } catch (e) {
      this.logger.error(`getLastSeenByErpIds failed: ${(e as Error).message}`);
    }
    return out;
  }

  /**
   * ERP customer codes that map to a given region — used to reconcile the
   * region-scoped screens against the feed.
   */
  async countByRegion(region: Region): Promise<number> {
    const counts = await this.getCustomerCounts();
    return counts.byRegion[region] ?? 0;
  }
}
