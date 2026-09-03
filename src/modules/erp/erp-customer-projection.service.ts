import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { buildCustomerProjectionSql } from './customer-projection';

/** Result of one projection pass. */
export interface ErpCustomerProjectionResult {
  /** False when this database has no `erp_raw` feed (CI, fresh local). */
  available: boolean;
  /** True when another instance held the lock and this pass did nothing. */
  skipped: boolean;
  /** Customers inserted on this pass. */
  inserted: number;
}

/**
 * Copies ERP customers into the portal's `Customer` table.
 *
 * The rules, and why each one is what it is, are in `customer-projection.ts`.
 * In short: insert the mapped customers that are missing, never touch one that
 * already exists, and give every projected row a synthetic phone because the
 * feed's phone numbers are a shared placeholder and phone is the login key.
 *
 * Runs on the same footing as the order-status reconciler: a timer, an
 * advisory lock so two instances cannot overlap, and a no-op on a database
 * with no `erp_raw` schema.
 */
@Injectable()
export class ErpCustomerProjectionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ErpCustomerProjectionService.name);

  /**
   * Advisory-lock key. Distinct from the order-status reconciler's, so the two
   * jobs never block each other. Taken as a TRANSACTION lock: Postgres releases
   * it at commit, so a crashed instance cannot strand it.
   */
  private static readonly LOCK_KEY = 5_530_002;

  private available: boolean | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * How often to re-project, in ms. `0` disables the timer, leaving only
   * `POST /erp/sync/customers` - which the ingest service should call once its
   * own customer run finishes.
   */
  private get intervalMs(): number {
    const raw = process.env.ERP_CUSTOMER_PROJECTION_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '') return 15 * 60 * 1000;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `ERP_CUSTOMER_PROJECTION_INTERVAL_MS="${raw}" is not a number — using the 15m default.`,
      );
      return 15 * 60 * 1000;
    }
    if (parsed > 0 && parsed < 60_000) return 60_000;
    return parsed;
  }

  onModuleInit(): void {
    const interval = this.intervalMs;
    if (interval === 0) {
      this.logger.log(
        'Periodic customer projection disabled (ERP_CUSTOMER_PROJECTION_INTERVAL_MS=0).',
      );
      return;
    }

    // Deferred and never awaited: a slow feed must not hold up start-up.
    setTimeout(() => void this.runQuietly(), 15_000).unref();
    this.timer = setInterval(() => void this.runQuietly(), interval);
    this.timer.unref();
    this.logger.log(
      `Customer projection scheduled every ${Math.round(interval / 1000)}s.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** True when this database carries the ERP customer feed. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ present: boolean }[]>(
        `SELECT to_regclass('erp_raw.raw_customer') IS NOT NULL AS present`,
      );
      this.available = rows[0]?.present === true;
      if (!this.available) {
        this.logger.warn(
          'erp_raw.raw_customer not found — ERP customers cannot be projected. ' +
            'This is expected on a database without the ERP feed.',
        );
      }
    } catch (e) {
      this.available = false;
      this.logger.error(
        `Could not probe erp_raw.raw_customer: ${(e as Error).message}. Treating it as absent.`,
      );
    }
    return this.available;
  }

  /** Insert every mapped ERP customer that has no `Customer` row yet. */
  async project(): Promise<ErpCustomerProjectionResult> {
    if (!(await this.isAvailable()))
      return { available: false, skipped: false, inserted: 0 };

    if (this.running) return { available: true, skipped: true, inserted: 0 };
    this.running = true;

    const startedAt = Date.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(${ErpCustomerProjectionService.LOCK_KEY}) AS locked`,
          );
          if (lock[0]?.locked !== true) {
            this.logger.log(
              'Another instance is projecting customers — skipping this pass.',
            );
            return { available: true, skipped: true, inserted: 0 };
          }

          const inserted = await tx.$executeRawUnsafe(
            buildCustomerProjectionSql(),
          );

          if (inserted > 0) {
            this.logger.log(
              `Projected ${inserted} ERP customer(s) into the portal in ${Date.now() - startedAt}ms.`,
            );
          }
          return { available: true, skipped: false, inserted };
        },
        // The feed is ~3.7k rows and the insert is one statement, but the
        // default 5s interactive budget is too tight to rely on.
        { timeout: 120_000, maxWait: 15_000 },
      );
    } finally {
      this.running = false;
    }
  }

  /** Timer entry point: a failing feed must never take the app down. */
  private async runQuietly(): Promise<void> {
    try {
      await this.project();
    } catch (e) {
      this.logger.error(`Customer projection failed: ${(e as Error).message}`);
    }
  }
}
