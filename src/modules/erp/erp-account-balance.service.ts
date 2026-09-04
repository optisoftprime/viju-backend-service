import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ERP_ACCOUNT_BALANCE_FOR_CUSTOMER_SQL,
  ERP_ACCOUNT_BALANCES_FOR_CUSTOMERS_SQL,
  ERP_ACCOUNT_BALANCE_RECONCILE_SQL,
  ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL,
} from './account-balance';

/** Result of one reconcile pass. */
export interface ErpAccountBalanceSyncResult {
  /** False when this database has no `erp_raw.raw_customer_credit` feed. */
  available: boolean;
  /** True when another instance held the lock and this pass did nothing. */
  skipped: boolean;
  /** Customers whose balance actually moved. */
  updated: number;
}

/**
 * Keeps `Customer.outstandingBalance` in step with the ERP customer-credit
 * feed, using the formula documented in `account-balance.ts`:
 *
 *   Running Balance = CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY
 *
 * WHY THIS EXISTS: the projector that populates `Customer` lives in another
 * service and copies the ERP's raw `CREDIT_PAY` into the balance column.
 * `CREDIT_PAY` is consumed credit, signed the other way round, so 80% of
 * customers currently read with an inverted balance — a distributor sitting on
 * ₦33.4m of credit is shown as owing ₦33.4m.
 *
 * Like `ErpOrderStatusService`, this is a reconciler, not a projector: it only
 * ever corrects the balance of customers that already exist, and only when the
 * derived value differs. It never creates or deletes a customer, and it leaves
 * customers with no credit record in the feed untouched rather than zeroing
 * them.
 *
 * ─── Interaction with delivery allowances ───────────────────────────────
 *
 * `BroadcastService.sendIndividual` bumps the balance the moment an allowance
 * is granted (PRD F15 AC5), before the ERP has booked it. A reconcile pass
 * would reset that bump to the ERP's figure until the next ingest catches up —
 * the same way the existing `POST /erp/sync/balance` webhook already
 * overwrites it. So the periodic timer is OFF by default: set
 * ERP_ACCOUNT_BALANCE_SYNC_INTERVAL_MS to enable it, or (preferably) have the
 * ingest service call `POST /erp/sync/account-balance` once its projector run
 * finishes, when the ERP figures are known to be fresh.
 */
@Injectable()
export class ErpAccountBalanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpAccountBalanceService.name);

  /**
   * Advisory-lock key, so two app instances pointed at the same database do
   * not reconcile concurrently. Distinct from the order-status reconciler's
   * key (5_530_001). Taken as a TRANSACTION lock: Postgres releases it at
   * commit, so a crashed instance cannot strand it.
   */
  private static readonly LOCK_KEY = 5_530_002;

  /** Cached probe for the credit feed; null until first checked. */
  private available: boolean | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * How often to re-reconcile, in ms. Defaults to `0` — disabled — so the
   * reconcile cannot fight the immediate-allowance rule on a timer. See the
   * class comment.
   */
  private get intervalMs(): number {
    const raw = process.env.ERP_ACCOUNT_BALANCE_SYNC_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '') return 0;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `ERP_ACCOUNT_BALANCE_SYNC_INTERVAL_MS="${raw}" is not a number — leaving the reconcile disabled.`,
      );
      return 0;
    }
    // Below a minute this would fight the ingest rather than follow it.
    if (parsed > 0 && parsed < 60_000) return 60_000;
    return parsed;
  }

  onModuleInit(): void {
    const interval = this.intervalMs;
    if (interval === 0) {
      this.logger.log(
        'Periodic account-balance reconcile disabled (the default). ' +
          'Balances follow POST /erp/sync/account-balance.',
      );
      return;
    }

    // Deferred, never awaited: a slow or unreachable ERP feed must not hold up
    // application start-up.
    setTimeout(() => void this.runQuietly(), 10_000).unref();

    this.timer = setInterval(() => void this.runQuietly(), interval);
    // Do not keep the process alive purely for this timer.
    this.timer.unref();
    this.logger.log(
      `Account-balance reconcile scheduled every ${Math.round(interval / 1000)}s.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** True when this database carries the ERP customer-credit feed. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_customer_credit') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
      if (!this.available) {
        this.logger.warn(
          'erp_raw.raw_customer_credit not found — account balances cannot be ' +
            'reconciled against the ERP. This is expected on a database without ' +
            'the ERP feed.',
        );
      }
    } catch (e) {
      // NOT cached: a probe that THREW tells us nothing about whether the
      // table exists - it is almost always the database being briefly
      // unreachable (P1017 on a dropped connection, a restart, a network
      // blip). Caching `false` here disabled the ERP feed for the whole
      // life of the process after one blip at boot, silently degrading
      // every screen that reads it. Leaving it unset means the next call
      // probes again.
      this.logger.error(
        `Could not probe erp_raw.raw_customer_credit: ${(e as Error).message}. ` +
          'Treating the feed as unavailable for this call only; will retry.',
      );
      return false;
    }
    return this.available;
  }

  /**
   * Re-derive every held customer's balance from the ERP credit feed.
   *
   * One set-based statement rather than a row-by-row loop: this spans every
   * projected customer, and Postgres can do the join in place.
   */
  async reconcile(): Promise<ErpAccountBalanceSyncResult> {
    if (!(await this.isAvailable()))
      return { available: false, skipped: false, updated: 0 };

    // Guard against overlapping passes inside this process too — the interval
    // can fire again while a slow pass is still running.
    if (this.running) return { available: true, skipped: true, updated: 0 };
    this.running = true;

    const startedAt = Date.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(${ErpAccountBalanceService.LOCK_KEY}) AS locked`,
          );
          if (lock[0]?.locked !== true) {
            this.logger.log(
              'Another instance is reconciling account balances — skipping this pass.',
            );
            return { available: true, skipped: true, updated: 0 };
          }

          const updated = await tx.$executeRawUnsafe(
            ERP_ACCOUNT_BALANCE_RECONCILE_SQL,
          );

          if (updated > 0) {
            this.logger.log(
              `Account balances reconciled against ERP: ${updated} customer(s) changed in ${Date.now() - startedAt}ms.`,
            );
          }
          return { available: true, skipped: false, updated };
        },
        // The rollup scans the credit feed; the default 5s interactive
        // transaction budget is not enough on a full customer set.
        { timeout: 120_000, maxWait: 15_000 },
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * The ERP running balance for one customer, without writing anything.
   *
   * Returns null when the feed is absent or holds no credit record for that
   * ERP code — callers should fall back to the stored balance rather than
   * showing a zero the ERP never stated.
   */
  async getRunningBalance(erpId: string): Promise<number | null> {
    if (!(await this.isAvailable())) return null;
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { running_balance: string | number | null }[]
      >(ERP_ACCOUNT_BALANCE_FOR_CUSTOMER_SQL, erpId);
      const raw = rows[0]?.running_balance;
      if (raw === undefined || raw === null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch (e) {
      this.logger.error(
        `getRunningBalance(${erpId}) failed: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * ERP running balances for a SET of customers, keyed by ERP code.
   *
   * The batched form of `getRunningBalance`, for list endpoints: one query per
   * page rather than one per row. An ERP code the feed holds no credit record
   * for is absent from the map — callers fall back to the stored column, the
   * same rule the single-customer path uses.
   *
   * Returns an empty map when the feed is absent (CI, a fresh local database)
   * or on any error, so a list endpoint degrades to stored balances rather
   * than failing.
   */
  async getRunningBalances(erpIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(erpIds.filter((id) => !!id))];
    if (ids.length === 0) return new Map();
    if (!(await this.isAvailable())) return new Map();
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { erp_id: string; running_balance: string | number | null }[]
      >(ERP_ACCOUNT_BALANCES_FOR_CUSTOMERS_SQL, ids);

      const balances = new Map<string, number>();
      for (const row of rows) {
        if (row.running_balance === null || row.running_balance === undefined)
          continue;
        const value = Number(row.running_balance);
        if (Number.isFinite(value)) balances.set(row.erp_id, value);
      }
      return balances;
    } catch (e) {
      this.logger.error(
        `getRunningBalances(${ids.length} customers) failed: ${(e as Error).message}`,
      );
      return new Map();
    }
  }

  /**
   * Temporary (supplementary) credit in force for one customer TODAY.
   *
   * Sums `CREDIT_AMT1` across every credit record whose
   * EFFECTIVE_DATE..INEFFECTIVE_DATE window contains today. Returns 0 when the
   * feed is absent, the customer has no record, or every window has expired -
   * "no temporary credit" and "no feed" are both legitimately zero here, unlike
   * the running balance, where a missing feed must fall back to the stored
   * column rather than claim a zero.
   */
  async getTemporaryCredit(erpId: string): Promise<number> {
    if (!erpId) return 0;
    if (!(await this.isAvailable())) return 0;
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        { temporary_credit: string | number | null }[]
      >(ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL, erpId);
      const raw = rows[0]?.temporary_credit;
      if (raw === undefined || raw === null) return 0;
      const value = Number(raw);
      return Number.isFinite(value) ? value : 0;
    } catch (e) {
      this.logger.error(
        `getTemporaryCredit(${erpId}) failed: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Timer entry point. A failing ERP feed must never take the app down, so
   * this logs and swallows rather than rejecting into an unhandled timer.
   */
  private async runQuietly(): Promise<void> {
    try {
      await this.reconcile();
    } catch (e) {
      this.logger.error(
        `Account-balance reconcile failed: ${(e as Error).message}`,
      );
    }
  }
}
