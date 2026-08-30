/**
 * One-off: repoint loading requests that reference a seeded (fake) Purchase
 * onto a REAL ERP order for the same customer, and rewrite `reference` from
 * that order's DOC_NO.
 *
 * The seed created Purchase rows whose erpId is `SEED-WB-…` rather than a real
 * DOC_NO, so `reference` and `linkedPurchase.erpId` both surfaced seed ids on
 * GET /customers/me/waybills, /officers/loading-requests and
 * /regional/loading-requests.
 *
 * Each stale request is given a DISTINCT real order that no loading request
 * currently points at, so the new references cannot collide with each other or
 * with an existing one. Runs in a single transaction: it either all lands or
 * none of it does.
 *
 * DRY RUN by default. Pass --apply to write.
 *
 *   node prisma/repoint-seeded-loading-requests.js            # show the plan
 *   node prisma/repoint-seeded-loading-requests.js --apply    # commit it
 *
 * Safe to re-run: once repointed, nothing matches the stale query any more.
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const stale = await prisma.loadingRequest.findMany({
    where: { linkedPurchase: { erpId: { startsWith: 'SEED-' } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      reference: true,
      customerId: true,
      linkedPurchaseId: true,
      customer: { select: { erpId: true, name: true } },
      linkedPurchase: { select: { erpId: true } },
    },
  });

  if (stale.length === 0) {
    console.log('Nothing to do: no loading request points at a seeded purchase.');
    return;
  }

  // Reserve real orders per customer, newest first, only ones no loading
  // request already uses - so every new reference is unique on its own.
  const plan = [];
  const takenPurchaseIds = new Set();
  for (const request of stale) {
    const candidate = await prisma.purchase.findFirst({
      where: {
        customerId: request.customerId,
        NOT: { erpId: { startsWith: 'SEED-' } },
        loadingRequests: { none: {} },
        id: { notIn: [...takenPurchaseIds] },
      },
      orderBy: { orderDate: 'desc' },
      select: { id: true, erpId: true },
    });
    if (!candidate) {
      throw new Error(
        `No unused real order left for customer ${request.customer.erpId}; nothing written.`,
      );
    }
    takenPurchaseIds.add(candidate.id);
    plan.push({ request, purchase: candidate });
  }

  // A reference must not collide with one already in the table.
  const existing = new Set(
    (
      await prisma.loadingRequest.findMany({ select: { reference: true } })
    ).map((r) => r.reference),
  );
  for (const row of plan) {
    if (existing.has(row.purchase.erpId)) {
      throw new Error(
        `Reference ${row.purchase.erpId} is already in use; nothing written.`,
      );
    }
    existing.add(row.purchase.erpId);
  }

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${plan.length} loading requests\n`);
  for (const { request, purchase } of plan) {
    console.log(
      `  ${request.customer.erpId}  ${String(request.reference).padEnd(22)}` +
        ` -> ${purchase.erpId}`,
    );
  }

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply to commit.');
    return;
  }

  await prisma.$transaction(
    plan.map(({ request, purchase }) =>
      prisma.loadingRequest.update({
        where: { id: request.id },
        data: { linkedPurchaseId: purchase.id, reference: purchase.erpId },
      }),
    ),
  );
  console.log(`\nUpdated ${plan.length} loading requests.`);

  const orphaned = await prisma.purchase.count({
    where: { erpId: { startsWith: 'SEED-' }, loadingRequests: { none: {} } },
  });
  console.log(
    `${orphaned} seeded Purchase rows are now unreferenced by any loading ` +
      `request (they still appear on the invoice list).`,
  );
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
