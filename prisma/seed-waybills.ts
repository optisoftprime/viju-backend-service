/**
 * Additive seed: purchases + linked waybills for LAGOS distributors.
 *
 * WHY THIS IS A SEPARATE FILE: `prisma/seed.ts` opens by deleting every
 * purchase, payment, ticket, message, broadcast and Staff row — that is what
 * destroyed the live purchase and payment tables on 2026-08-21. This script
 * shares none of that. It performs INSERTS ONLY:
 *
 *   • no deleteMany, no truncate, no drop — anywhere in this file
 *   • no UPDATE of any pre-existing row (balances, customers, staff and the
 *     ERP-projected orders are all left exactly as they are)
 *   • every row it writes is tagged with the SEED_PREFIX below, so what it
 *     created can always be told apart from real ERP data — and removed again
 *     (see "Undo" at the bottom of this comment)
 *
 * It exists so `POST /customers/me/waybills` can be exercised end to end:
 * `linkedPurchaseId` needs a Purchase id belonging to the caller, and
 * `GET /customers/me/waybills` needs LoadingRequest rows to list.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *
 *   npm run db:seed:waybills                 # DRY RUN — prints the plan only
 *   npm run db:seed:waybills -- --apply      # actually writes
 *
 *   --apply                 write to the database (without it, nothing is written)
 *   --region=LAGOS          region to seed (default LAGOS)
 *   --erp-id=10110017       one customer only; overrides --region
 *   --per-customer=10       purchases AND waybills per customer (default 10)
 *   --max-customers=25      safety cap (default 25; raise deliberately)
 *
 * Re-running is safe: rows are keyed on deterministic ids
 * (`SEED-WB-<erpId>-<n>`), and anything already present is skipped rather than
 * duplicated.
 *
 * ─── Undo ───────────────────────────────────────────────────────────────
 *
 * Everything this script creates can be removed without touching real data:
 *
 *   DELETE FROM "LoadingRequest" WHERE reference   LIKE 'SEED-WB-%';
 *   DELETE FROM "PurchaseItem"   WHERE "purchaseId" IN
 *     (SELECT id FROM "Purchase" WHERE "erpId" LIKE 'SEED-WB-%');
 *   DELETE FROM "Purchase"       WHERE "erpId"     LIKE 'SEED-WB-%';
 *
 * (LoadingRequest first — it references Purchase.)
 */
import { PrismaClient, LoadingRequestStatus, Region } from '@prisma/client';

const prisma = new PrismaClient();

/** Marks every row this script writes. Never change it — Undo depends on it. */
const SEED_PREFIX = 'SEED-WB';

const PRODUCTS = [
  { name: 'Viju Apple Drink 400ml', unitPrice: 1800 },
  { name: 'Viju Orange Drink 400ml', unitPrice: 1800 },
  { name: 'Viju Pineapple Drink 400ml', unitPrice: 1850 },
  { name: 'Viju Milk 330ml', unitPrice: 2400 },
  { name: 'Viju Milk 1L', unitPrice: 4200 },
  { name: 'Viju Yoghurt 200ml', unitPrice: 1500 },
  { name: 'Viju Chocolate Drink 330ml', unitPrice: 2100 },
  { name: 'Viju Wheat Drink 400ml', unitPrice: 1950 },
  { name: 'Viju Malt 330ml', unitPrice: 2250 },
  { name: 'Viju Water 75cl (12 pack)', unitPrice: 1200 },
];

const ORDER_STATUSES = [
  'DELIVERED',
  'PROCESSING',
  'DELIVERED',
  'CLOSED',
  'PENDING',
  'DISPATCHED',
  'DELIVERED',
  'LOADED',
  'PROCESSING',
  'DELIVERED',
] as const;

/**
 * One waybill per purchase, cycling every status so the customer list, the
 * regional queue and the loading-officer queue all have something to show.
 */
const WAYBILL_STATUSES: LoadingRequestStatus[] = [
  'COMPLETED',
  'PENDING_ASSIGNMENT',
  'LOADING_IN_PROGRESS',
  'ASSIGNED',
  'PENDING_ASSIGNMENT',
  'COMPLETED',
  'CANCELLED',
  'ASSIGNED',
  'LOADING_IN_PROGRESS',
  'COMPLETED',
];

const DRIVERS = [
  { name: 'Jimoh Ibrahim', phone: '+2348012345678' },
  { name: 'John Dare', phone: '+2348023456789' },
  { name: 'Tunde Bakare', phone: '+2348034567890' },
  { name: 'Musa Aliyu', phone: '+2348045678901' },
  { name: 'Emeka Obi', phone: '+2348056789012' },
];

const DESTINATIONS = [
  'Yaba Warehouse',
  'Ikeja Depot',
  'Apapa Warehouse',
  'Surulere Depot',
  'Lekki Distribution Point',
];

const WAYBILL_DOC_URL =
  'https://res.cloudinary.com/dx87iv1qi/image/upload/v1782143013/viju/product-flyers/mat2kk5lbp9fo0y2imky.jpg';

interface Options {
  apply: boolean;
  region: Region;
  erpId: string | null;
  perCustomer: number;
  maxCustomers: number;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${flag}=`));
    return hit ? hit.slice(flag.length + 3) : null;
  };
  const int = (flag: string, fallback: number): number => {
    const raw = get(flag);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--${flag} must be a positive integer (got "${raw}").`);
    }
    return n;
  };

  return {
    apply: argv.includes('--apply'),
    region: (get('region') ?? 'LAGOS') as Region,
    erpId: get('erp-id'),
    perCustomer: int('per-customer', 10),
    maxCustomers: int('max-customers', 25),
  };
}

/** Deterministic pseudo-randomness, so re-runs produce identical rows. */
function seededInt(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return min + (Math.abs(h) % (max - min + 1));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('🚚  Additive waybill seed (INSERT ONLY — deletes nothing)');
  console.log('');

  // ─── Pick the customers ────────────────────────────────────────────
  const where = opts.erpId ? { erpId: opts.erpId } : { region: opts.region };

  const matching = await prisma.customer.count({ where });
  const customers = await prisma.customer.findMany({
    where,
    select: { id: true, erpId: true, name: true, region: true },
    orderBy: { erpId: 'asc' },
    take: opts.maxCustomers,
  });

  if (customers.length === 0) {
    console.log(
      opts.erpId
        ? `   No customer with erpId "${opts.erpId}" in this database.`
        : `   No customers in region ${opts.region} in this database.`,
    );
    console.log('   Nothing to do.\n');
    return;
  }

  const purchasesPlanned = customers.length * opts.perCustomer;

  console.log(
    `   Target      : ${opts.erpId ? `erpId ${opts.erpId}` : `region ${opts.region}`}`,
  );
  console.log(`   Matching    : ${matching} customer(s)`);
  console.log(
    `   Seeding     : ${customers.length} customer(s)` +
      (matching > customers.length
        ? `  (capped by --max-customers=${opts.maxCustomers})`
        : ''),
  );
  console.log(
    `   Per customer: ${opts.perCustomer} purchases + ${opts.perCustomer} waybills`,
  );
  console.log(
    `   Total new   : ${purchasesPlanned} purchases, ${purchasesPlanned} waybills, ` +
      `~${purchasesPlanned * 2} purchase items`,
  );
  console.log('');

  if (matching > customers.length) {
    console.log(
      `   ⚠️  ${matching - customers.length} more customer(s) match but were not ` +
        `included.\n       Raise the cap with --max-customers=${matching} to cover them all.`,
    );
    console.log('');
  }

  if (!opts.apply) {
    console.log('   DRY RUN — nothing was written.');
    console.log('   Re-run with --apply to commit these rows.\n');
    return;
  }

  // A LAGOS loading officer to hang assigned waybills off. Looked up, never
  // created: this script does not write Staff rows.
  const officer = await prisma.staff.findFirst({
    where: { role: 'LOADING_OFFICER', region: opts.region, isActive: true },
    select: { id: true },
  });
  const assigner = await prisma.staff.findFirst({
    where: { role: 'REGIONAL_ADMIN', region: opts.region, isActive: true },
    select: { id: true },
  });
  if (!officer) {
    console.log(
      `   Note: no active LOADING_OFFICER in ${opts.region} — waybills that would ` +
        'be assigned\n         are written as PENDING_ASSIGNMENT instead.',
    );
    console.log('');
  }

  let createdPurchases = 0;
  let createdWaybills = 0;
  let skipped = 0;

  for (const customer of customers) {
    for (let i = 0; i < opts.perCustomer; i++) {
      const n = (i + 1).toString().padStart(2, '0');
      const purchaseErpId = `${SEED_PREFIX}-${customer.erpId}-${n}`;
      const waybillRef = `${SEED_PREFIX}-${customer.erpId}-${n}`;

      // Idempotency: a previous run already made this pair.
      const existing = await prisma.purchase.findUnique({
        where: { erpId: purchaseErpId },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const productA =
        PRODUCTS[seededInt(`${purchaseErpId}-a`, 0, PRODUCTS.length - 1)];
      const productB =
        PRODUCTS[seededInt(`${purchaseErpId}-b`, 0, PRODUCTS.length - 1)];
      const qtyA = seededInt(`${purchaseErpId}-qa`, 40, 320);
      const qtyB = seededInt(`${purchaseErpId}-qb`, 20, 180);
      const lineA = qtyA * productA.unitPrice;
      const lineB = qtyB * productB.unitPrice;

      const orderDate = new Date(Date.UTC(2026, 4, 4 + i, 9, 0, 0));
      const status = ORDER_STATUSES[i % ORDER_STATUSES.length];

      let waybillStatus = WAYBILL_STATUSES[i % WAYBILL_STATUSES.length];
      if (
        !officer &&
        waybillStatus !== 'PENDING_ASSIGNMENT' &&
        waybillStatus !== 'CANCELLED'
      ) {
        waybillStatus = 'PENDING_ASSIGNMENT';
      }
      const isAssigned = waybillStatus !== 'PENDING_ASSIGNMENT';
      const isCompleted = waybillStatus === 'COMPLETED';
      const driver = DRIVERS[i % DRIVERS.length];
      const loadingDate = new Date(Date.UTC(2026, 4, 6 + i, 8, 0, 0));

      // Purchase + its items + the waybill land together, so a failure can
      // never leave a half-built order behind.
      await prisma.$transaction(async (tx) => {
        const purchase = await tx.purchase.create({
          data: {
            erpId: purchaseErpId,
            customerId: customer.id,
            orderDate,
            totalItems: qtyA + qtyB,
            totalValue: lineA + lineB,
            status,
            statusUpdatedAt: orderDate,
            items: {
              create: [
                {
                  productName: productA.name,
                  itemCode: `${SEED_PREFIX}-ITM-${n}A`,
                  quantity: qtyA,
                  unitPrice: productA.unitPrice,
                  lineTotal: lineA,
                },
                {
                  productName: productB.name,
                  itemCode: `${SEED_PREFIX}-ITM-${n}B`,
                  quantity: qtyB,
                  unitPrice: productB.unitPrice,
                  lineTotal: lineB,
                },
              ],
            },
          },
          select: { id: true },
        });

        await tx.loadingRequest.create({
          data: {
            reference: waybillRef,
            customerId: customer.id,
            region: customer.region,
            linkedPurchaseId: purchase.id,
            truckPlateNumber: `LAG-${(100 + seededInt(waybillRef, 0, 799)).toString()}-XY`,
            driverName: driver.name,
            driverPhone: driver.phone,
            requestedLoadingDate: loadingDate,
            quantityCartons: Math.max(1, Math.round((qtyA + qtyB) / 2)),
            destination: DESTINATIONS[i % DESTINATIONS.length],
            termsAcceptedAt: orderDate,
            status: waybillStatus,
            assignedOfficerId: isAssigned ? (officer?.id ?? null) : null,
            assignedAt: isAssigned ? loadingDate : null,
            assignedById: isAssigned ? (assigner?.id ?? null) : null,
            loadingStartedAt:
              waybillStatus === 'LOADING_IN_PROGRESS' || isCompleted
                ? loadingDate
                : null,
            completedAt: isCompleted
              ? new Date(loadingDate.getTime() + 6 * 60 * 60 * 1000)
              : null,
            waybillDocumentUrl: isCompleted ? WAYBILL_DOC_URL : null,
          },
        });
      });

      createdPurchases++;
      createdWaybills++;
    }
  }

  console.log('   ✅ Done.');
  console.log(`      purchases created : ${createdPurchases}`);
  console.log(`      waybills created  : ${createdWaybills}`);
  if (skipped > 0) {
    console.log(`      skipped (existed) : ${skipped}`);
  }
  console.log('');
  console.log(
    '   Nothing was deleted or updated. To remove these rows again, see',
  );
  console.log('   the "Undo" block at the top of prisma/seed-waybills.ts.');
  console.log('');
}

main()
  .catch((e) => {
    console.error('\n❌ Waybill seed failed:', e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
