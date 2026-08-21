import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ERP_ORDER_STATUS_RECONCILE_SQL } from './order-status';

/** Result of one reconcile pass. */
export interface ErpOrderStatusSyncResult {
  /** False when this database has no `erp_raw` feed (CI, fresh local). */
  available: boolean;
  /** True when another instance held the lock and this pass did nothing. */
  skipped: boolean;
  /** Orders whose status actually moved. */
  updated: number;
}

/**
 * Keeps `Purchase.status` in step with the ERP sales-order feed.
 *
 * WHY THIS EXISTS: order rows reach us through a projector that lives in
 * another service, and that projector writes a constant PROCESSING. Every one
 * of the 5.6k orders in this database read "Processing" as a result, including
 * orders the ERP closed off years ago. This service re-derives the status from
 * `erp_raw.raw_sales_order` — the same rows the projector reads — using the
 * rules documented in `order-status.ts`.
 *
 * It is a reconciler, not a projector: it only ever corrects the status of
 * orders that already exist, and only when the derived value differs. It never
 * creates, deletes, or otherwise touches an order.
 *
 * The feed is optional. On a database without `erp_raw` (CI, a fresh local
 * environment) every pass reports `available: false` and changes nothing,
 * matching how `ErpRawService` degrades.
 */
@Injectable()
export class ErpOrderStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpOrderStatusService.name);

  /**
   * Advisory-lock key, so two app instances pointed at the same database do
   * not run the reconcile concurrently. Taken as a TRANSACTION lock: Postgres
   * releases it at commit, which means a crashed instance cannot strand it.
   */
  private static readonly LOCK_KEY = 5_530_001;

  /** Cached probe for the sales-order feed; null until first checked. */
  private available: boolean | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * How often to re-reconcile, in ms. `0` disables the timer entirely, leaving
   * only the `POST /erp/sync/order-status` webhook — which is what the ingest
   * service should call once its projector run finishes.
   */
  private get intervalMs(): number {
    const raw = process.env.ERP_ORDER_STATUS_SYNC_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '') return 15 * 60 * 1000;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `ERP_ORDER_STATUS_SYNC_INTERVAL_MS="${raw}" is not a number — using the 15m default.`,
      );
      return 15 * 60 * 1000;
    }
    // Below a minute this would fight the ingest rather than follow it.
    if (parsed > 0 && parsed < 60_000) return 60_000;
    return parsed;
  }

  onModuleInit(): void {
    const interval = this.intervalMs;
    if (interval === 0) {
      this.logger.log(
        'Periodic order-status reconcile disabled (ERP_ORDER_STATUS_SYNC_INTERVAL_MS=0).',
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
      `Order-status reconcile scheduled every ${Math.round(interval / 1000)}s.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

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
          'erp_raw.raw_sales_order not found — order statuses cannot be reconciled ' +
            'against the ERP. This is expected on a database without the ERP feed.',
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
   * Re-derive every held order's status from the ERP feed.
   *
   * One set-based statement rather than a row-by-row loop: the rollup spans
   * ~350k raw line rows, and pulling those through the app would be both slow
   * and pointless when Postgres can do the join in place.
   */
  async reconcile(): Promise<ErpOrderStatusSyncResult> {
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
            `SELECT pg_try_advisory_xact_lock(${ErpOrderStatusService.LOCK_KEY}) AS locked`,
          );
          if (lock[0]?.locked !== true) {
            this.logger.log(
              'Another instance is reconciling order statuses — skipping this pass.',
            );
            return { available: true, skipped: true, updated: 0 };
          }

          const updated = await tx.$executeRawUnsafe(
            ERP_ORDER_STATUS_RECONCILE_SQL,
          );

          if (updated > 0) {
            this.logger.log(
              `Order status reconciled against ERP: ${updated} order(s) changed in ${Date.now() - startedAt}ms.`,
            );
          }
          return { available: true, skipped: false, updated };
        },
        // The rollup scans the sales-order feed; the default 5s interactive
        // transaction budget is nowhere near enough.
        { timeout: 120_000, maxWait: 15_000 },
      );
    } finally {
      this.running = false;
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
        `Order-status reconcile failed: ${(e as Error).message}`,
      );
    }
  }
}
