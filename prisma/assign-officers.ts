/**
 * Assign every customer to the account officer for their own region.
 *
 * WHY THIS EXISTS: portal `Customer` rows are written by a projector in the
 * ingest service that knows nothing about staff, so it leaves
 * `assignedOfficerId` NULL. A customer with no officer has no chat
 * counterparty, no ticket owner and no notification recipient.
 *
 * `DefaultOfficerService` already fixes this — but only for ONE region
 * (DEFAULT_ACCOUNT_OFFICER_REGION, LAGOS by default), because parking a NORTH
 * customer on a LAGOS officer would build a portfolio that
 * `AdminService.reassignAllCustomers` could never unwind: that route validates
 * a bulk move against the SOURCE officer's region.
 *
 * This script does not have that problem, because it never crosses regions —
 * each customer goes to an officer who is already in their own region. It
 * reuses `DEFAULT_OFFICER_RECONCILE_SQL` verbatim, once per region, so the
 * write semantics are exactly the ones that service already applies:
 *
 *   1. `Customer.assignedOfficerId` — the pointer admin lists, dashboards and
 *      the officer portal read.
 *   2. A primary `CustomerOfficer` row — what chat threads, tickets and
 *      notification fan-out resolve through. Writing only (1) would leave an
 *      officer who owns the customer but receives none of their messages.
 *
 * `Customer.updatedAt` is deliberately not bumped: the customer portal reports
 * it as the balance's `lastUpdated` and the officer portal as the
 * `lastContactDate` fallback, and neither of those changed here.
 *
 * SAFETY: no deleteMany, no truncate, and no customer that already has an
 * officer is touched — an admin reassignment stays permanent, exactly as
 * `DEFAULT_OFFICER_RECONCILE_SQL` guarantees with its `IS NULL` guard.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *
 *   npm run db:assign:officers                # DRY RUN — prints the plan only
 *   npm run db:assign:officers -- --apply     # actually writes
 *
 *   --apply             write to the database (without it, nothing is written)
 *   --region=LAGOS      limit to one region (default: all five)
 *   --fix-mismatched    ALSO move customers whose current officer sits in a
 *                       different region than the customer. Off by default.
 *                       This only ever repairs broken cross-region state; it
 *                       never overrides a same-region admin choice.
 *
 * Officer emails default to the map below and can be overridden per region
 * with OFFICER_EMAIL_<REGION>, e.g. OFFICER_EMAIL_LAGOS=someone@viju.local.
 *
 * ─── Undo ───────────────────────────────────────────────────────────────
 *
 *   UPDATE "Customer" SET "assignedOfficerId" = NULL
 *    WHERE "assignedOfficerId" IN (SELECT id FROM "Staff" WHERE email LIKE 'officer.%@viju.local');
 *   DELETE FROM "CustomerOfficer"
 *    WHERE "staffId" IN (SELECT id FROM "Staff" WHERE email LIKE 'officer.%@viju.local');
 */
import { PrismaClient } from '@prisma/client';
import {
  Region,
  REGION_VALUES,
  isRegion,
} from '../src/common/region/region.constants';
import { DEFAULT_OFFICER_RECONCILE_SQL } from '../src/modules/erp/default-officer';

const prisma = new PrismaClient();

/** The account officer each region's customers are assigned to. */
const OFFICER_BY_REGION: Readonly<Record<Region, string>> = {
  LAGOS: 'officer.lagos1@viju.local',
  EASTERN: 'officer.eastern1@viju.local',
  SOUTH_SOUTH: 'officer.southsouth1@viju.local',
  WESTERN: 'officer.western1@viju.local',
  NORTH: 'officer.north1@viju.local',
};

/** Per-region override, e.g. OFFICER_EMAIL_SOUTH_SOUTH=other@viju.local */
function officerEmailFor(region: Region): string {
  const raw = process.env[`OFFICER_EMAIL_${region}`];
  if (raw === undefined || raw.trim() === '') return OFFICER_BY_REGION[region];
  return raw.trim().toLowerCase();
}

/**
 * Repairs cross-region assignments: a customer whose officer belongs to a
 * different region is released back to NULL so the reconcile below can claim
 * them for the right one. Same-region assignments are never touched.
 */
const CLEAR_MISMATCHED_SQL = `
UPDATE "Customer" c
   SET "assignedOfficerId" = NULL
  FROM "Staff" s
 WHERE s.id = c."assignedOfficerId"
   AND c.region = $1::"Region"
   AND s.region IS DISTINCT FROM c.region`;

interface Options {
  apply: boolean;
  region: Region | null;
  fixMismatched: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit ? hit.slice(flag.length + 3) : null;
  };
  const rawRegion = get('region');
  if (rawRegion !== null && !isRegion(rawRegion.trim().toUpperCase())) {
    throw new Error(
      `--region must be one of ${REGION_VALUES.join(', ')} (got "${rawRegion}").`,
    );
  }
  return {
    apply: argv.includes('--apply'),
    region:
      rawRegion === null ? null : (rawRegion.trim().toUpperCase() as Region),
    fixMismatched: argv.includes('--fix-mismatched'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const regions = opts.region ? [opts.region] : [...REGION_VALUES];

  console.log('');
  console.log('👥  Assign customers to their regional account officer');
  console.log('');

  let totalAssigned = 0;
  let totalCleared = 0;

  for (const region of regions) {
    const email = officerEmailFor(region);

    const officer = await prisma.staff.findFirst({
      where: { email, role: 'OFFICER', isActive: true },
      select: { id: true, name: true, region: true },
    });

    const customers = await prisma.customer.count({ where: { region } });
    const unassigned = await prisma.customer.count({
      where: { region, assignedOfficerId: null },
    });
    const mismatched = await prisma.customer.count({
      where: {
        region,
        assignedOfficer: { is: { region: { not: region } } },
      },
    });

    const label = `${region.padEnd(12)}`;

    if (!officer) {
      console.log(
        `   ${label} ✋ skipped — no active OFFICER with email ${email}`,
      );
      continue;
    }
    if (officer.region !== region) {
      // Refuse rather than build the cross-region portfolio the bulk-reassign
      // route cannot unwind.
      console.log(
        `   ${label} ✋ skipped — ${email} is in ${officer.region}, not ${region}`,
      );
      continue;
    }

    const willFix = opts.fixMismatched ? mismatched : 0;
    const willAssign = unassigned + willFix;

    console.log(
      `   ${label} ${customers} customer(s), ${unassigned} unassigned` +
        (mismatched > 0
          ? `, ${mismatched} in another region's portfolio${opts.fixMismatched ? ' (will be moved)' : ' (left alone — pass --fix-mismatched)'}`
          : '') +
        ` → ${email}`,
    );

    if (!opts.apply || willAssign === 0) {
      totalAssigned += willAssign;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      if (opts.fixMismatched && mismatched > 0) {
        const cleared = await tx.$executeRawUnsafe(
          CLEAR_MISMATCHED_SQL,
          region,
        );
        totalCleared += cleared;
      }
      const assigned = await tx.$executeRawUnsafe(
        DEFAULT_OFFICER_RECONCILE_SQL,
        officer.id,
        region,
      );
      totalAssigned += assigned;
      console.log(`   ${' '.repeat(12)} ✅ assigned ${assigned}`);
    });
  }

  console.log('');
  if (!opts.apply) {
    console.log(
      `   DRY RUN — nothing was written (${totalAssigned} would be assigned).`,
    );
    console.log('   Re-run with --apply to commit.\n');
    return;
  }
  console.log(`   ✅ Done. ${totalAssigned} customer(s) assigned.`);
  if (totalCleared > 0) {
    console.log(`      ${totalCleared} cross-region assignment(s) repaired.`);
  }
  console.log('');
  console.log(
    '   Customers that already had a same-region officer were left alone.',
  );
  console.log(
    '   Undo instructions are at the top of prisma/assign-officers.ts.',
  );
  console.log('');
}

main()
  .catch((e) => {
    console.error('\n❌ Officer assignment failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
