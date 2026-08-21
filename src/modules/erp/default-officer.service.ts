import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  DEFAULT_OFFICER_RECONCILE_SQL,
  defaultAccountOfficerEmail,
  defaultAccountOfficerRegion,
  hasInvalidRegionOverride,
} from './default-officer';
import { Region } from '../../common/region/region.constants';

/** Result of one default-officer reconcile pass. */
export interface DefaultOfficerSyncResult {
  /** False when the configured default officer has no active Staff row. */
  available: boolean;
  /** True when another instance held the lock and this pass did nothing. */
  skipped: boolean;
  /** Customers parked on the default officer by this pass. */
  assigned: number;
  /** The email the default officer was looked up by. */
  officerEmail: string;
  /** The ONLY region whose customers this pass considered. */
  region: Region;
}

/**
 * Parks LAGOS customers that have no account officer on the default officer.
 *
 * This is a reconciler, not a projector — the same shape as
 * `ErpOrderStatusService`, and for the same reason: customers are inserted by
 * an out-of-process ingest projector, so the app cannot hook their creation
 * and has to notice them after the fact. It only ever fills a NULL pointer; it
 * never creates a customer, never deletes one, and never moves a customer an
 * admin has already assigned.
 *
 * It is scoped to ONE region (DEFAULT_ACCOUNT_OFFICER_REGION, LAGOS by
 * default). Customers in every other region are left unassigned for a regional
 * officer to pick up — see `default-officer.ts` for why that boundary matters.
 *
 * The default officer is optional. On a database where that Staff row does not
 * exist (CI, a fresh local environment before the seed) every pass reports
 * `available: false` and changes nothing, matching how `ErpRawService` and
 * `ErpOrderStatusService` degrade.
 */
@Injectable()
export class DefaultOfficerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DefaultOfficerService.name);

  /**
   * Advisory-lock key, so two app instances pointed at the same database do
   * not park the same customers concurrently. Taken as a TRANSACTION lock:
   * Postgres releases it at commit, so a crashed instance cannot strand it.
   * 5_530_001 belongs to the order-status reconcile.
   */
  private static readonly LOCK_KEY = 5_530_002;

  /**
   * Whether the default officer was resolvable on the previous pass, so the
   * "not found" warning is logged on transition instead of every tick. Unlike
   * the erp_raw probe this is NOT a permanent cache — the Staff row can appear
   * later (the seed, or an ADMIN creating the officer through
   * POST /admin/officers), and the next pass must pick it up.
   */
  private lastResolved: boolean | null = null;
  /** Same idea for the officer-region mismatch warning below. */
  private warnedRegionMismatch = false;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * How often to re-reconcile, in ms. `0` disables the timer entirely, leaving
   * only `POST /erp/sync/default-officer` — which is what the ingest service
   * should call once its customer projector run finishes.
   */
  private get intervalMs(): number {
    const raw = process.env.DEFAULT_OFFICER_SYNC_INTERVAL_MS;
    if (raw === undefined || raw.trim() === '') return 15 * 60 * 1000;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      this.logger.warn(
        `DEFAULT_OFFICER_SYNC_INTERVAL_MS="${raw}" is not a number — using the 15m default.`,
      );
      return 15 * 60 * 1000;
    }
    // Below a minute this would fight the ingest rather than follow it.
    if (parsed > 0 && parsed < 60_000) return 60_000;
    return parsed;
  }

  onModuleInit(): void {
    // A typo here must not silently widen the scope to a region nobody meant.
    if (hasInvalidRegionOverride()) {
      this.logger.warn(
        `DEFAULT_ACCOUNT_OFFICER_REGION="${process.env.DEFAULT_ACCOUNT_OFFICER_REGION}" ` +
          `is not a Viju region — falling back to ${defaultAccountOfficerRegion()}.`,
      );
    }

    const interval = this.intervalMs;
    if (interval === 0) {
      this.logger.log(
        'Periodic default-officer reconcile disabled (DEFAULT_OFFICER_SYNC_INTERVAL_MS=0).',
      );
      return;
    }

    // Deferred, never awaited: a slow database must not hold up start-up.
    setTimeout(() => void this.runQuietly(), 10_000).unref();

    this.timer = setInterval(() => void this.runQuietly(), interval);
    // Do not keep the process alive purely for this timer.
    this.timer.unref();
    this.logger.log(
      `Default-officer reconcile scheduled every ${Math.round(interval / 1000)}s ` +
        `(${defaultAccountOfficerRegion()} customers → ${defaultAccountOfficerEmail()}).`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Staff id of the configured default officer, or null when there is no
   * active OFFICER with that email.
   *
   * The role and isActive filters matter: parking customers on a deactivated
   * account would hide them from every portal, and `setOfficerActive` refuses
   * to deactivate an officer who still holds customers, so a stale pointer
   * here would also wedge that flow.
   */
  async resolveOfficerId(): Promise<string | null> {
    const email = defaultAccountOfficerEmail();
    const targetRegion = defaultAccountOfficerRegion();
    const officer = await this.prisma.staff.findFirst({
      where: { email, role: 'OFFICER', isActive: true },
      select: { id: true, region: true },
    });

    const resolved = officer !== null;
    if (resolved !== this.lastResolved) {
      if (resolved) {
        this.logger.log(`Default account officer resolved: ${email}.`);
      } else {
        this.logger.warn(
          `No active OFFICER with email "${email}" — ${targetRegion} customers ` +
            'without an account officer cannot be parked and will stay ' +
            'unassigned. Set DEFAULT_ACCOUNT_OFFICER_EMAIL to an existing ' +
            'officer, or create that officer.',
        );
      }
      this.lastResolved = resolved;
    }

    // Parking customers on an officer posted to a different region builds a
    // portfolio that reassignAllCustomers can never unwind — it validates the
    // target against the SOURCE officer's region. The officer's region is
    // admin-managed, so a reposting can make this true later.
    if (
      officer !== null &&
      officer.region !== targetRegion &&
      !this.warnedRegionMismatch
    ) {
      this.logger.warn(
        `Default officer ${email} is posted to ${officer.region ?? 'no region'} ` +
          `but ${targetRegion} customers are being parked on them. Bulk ` +
          'reassignment away from this officer will only offer officers in ' +
          `${officer.region ?? 'their region'}.`,
      );
      this.warnedRegionMismatch = true;
    }

    return officer?.id ?? null;
  }

  /**
   * Park every customer in the target region that has a NULL account officer.
   *
   * One set-based statement rather than a row-by-row loop: the first pass
   * after an ERP customer import can span tens of thousands of rows, and
   * pulling those through the app would be both slow and pointless when
   * Postgres can do the update and the join-row insert in place.
   */
  async reconcile(): Promise<DefaultOfficerSyncResult> {
    const officerEmail = defaultAccountOfficerEmail();
    const region = defaultAccountOfficerRegion();
    const officerId = await this.resolveOfficerId();
    if (officerId === null)
      return {
        available: false,
        skipped: false,
        assigned: 0,
        officerEmail,
        region,
      };

    // Guard against overlapping passes inside this process too — the interval
    // can fire again while a slow pass is still running.
    if (this.running)
      return {
        available: true,
        skipped: true,
        assigned: 0,
        officerEmail,
        region,
      };
    this.running = true;

    const startedAt = Date.now();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
            `SELECT pg_try_advisory_xact_lock(${DefaultOfficerService.LOCK_KEY}) AS locked`,
          );
          if (lock[0]?.locked !== true) {
            this.logger.log(
              'Another instance is parking unassigned customers — skipping this pass.',
            );
            return {
              available: true,
              skipped: true,
              assigned: 0,
              officerEmail,
              region,
            };
          }

          const assigned = await tx.$executeRawUnsafe(
            DEFAULT_OFFICER_RECONCILE_SQL,
            officerId,
            region,
          );

          if (assigned > 0) {
            this.logger.log(
              `Parked ${assigned} unassigned ${region} customer(s) on ` +
                `${officerEmail} in ${Date.now() - startedAt}ms.`,
            );
          }
          return {
            available: true,
            skipped: false,
            assigned,
            officerEmail,
            region,
          };
        },
        // The first pass after a bulk ERP customer import touches every row in
        // the region; the default 5s interactive budget is not enough.
        { timeout: 120_000, maxWait: 15_000 },
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Assign one specific customer, if and only if they are in the target region
   * AND have no officer yet.
   *
   * Used on the create path so a newly created LAGOS customer has an officer
   * immediately rather than up to one tick later. Returns the Staff id the
   * customer ended up with, or null when nothing was assigned — no default
   * officer configured, the customer is in another region, or they already had
   * an officer.
   */
  async assignIfUnassigned(customerId: string): Promise<string | null> {
    const region = defaultAccountOfficerRegion();
    const officerId = await this.resolveOfficerId();
    if (officerId === null) return null;

    return this.prisma.$transaction(async (tx) => {
      // updateMany, not update: both the region and the NULL check belong in
      // the WHERE so the read and the write cannot race a concurrent admin
      // reassignment.
      const claimed = await tx.customer.updateMany({
        where: { id: customerId, assignedOfficerId: null, region },
        data: { assignedOfficerId: officerId },
      });
      if (claimed.count === 0) return null;

      await tx.customerOfficer.upsert({
        where: { customerId_staffId: { customerId, staffId: officerId } },
        update: { isPrimary: true },
        create: { customerId, staffId: officerId, isPrimary: true },
      });
      return officerId;
    });
  }

  /**
   * Timer entry point. A failing pass must never take the app down, so this
   * logs and swallows rather than rejecting into an unhandled timer.
   */
  private async runQuietly(): Promise<void> {
    try {
      await this.reconcile();
    } catch (e) {
      this.logger.error(
        `Default-officer reconcile failed: ${(e as Error).message}`,
      );
    }
  }
}
