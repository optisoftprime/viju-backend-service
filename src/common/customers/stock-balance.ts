import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Cartons paid for but not yet loaded, per customer (B-1.1, AO-P2).
 *
 * Ordered minus completed loading requests, floored at zero. Two aggregates
 * regardless of how many customers are passed in, so it costs the same for a
 * page of 20 as for a page of 200.
 *
 * Shared by GET /admin/customers, GET /regional/customers and
 * GET /officers/customers so the STOCK column means exactly the same number on
 * every screen that shows it.
 *
 * Returns a map keyed by customer id; a customer with no purchases is absent
 * from the map, which callers read as 0.
 */
export async function stockBalanceByCustomer(
  prisma: PrismaService,
  customerIds: string[],
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();

  const [orderedRows, loadedRows] = await Promise.all([
    prisma.$queryRaw<{ customerId: string; qty: number }[]>`
        SELECT p."customerId" AS "customerId",
               COALESCE(SUM(i.quantity), 0)::int AS qty
          FROM "PurchaseItem" i
          JOIN "Purchase" p ON p.id = i."purchaseId"
         WHERE p."customerId" = ANY(${customerIds})
         GROUP BY 1`,
    prisma.loadingRequest.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, status: 'COMPLETED' },
      _sum: { quantityCartons: true },
    }),
  ]);

  const ordered = new Map(orderedRows.map((r) => [r.customerId, r.qty]));
  const loaded = new Map(
    loadedRows.map((r) => [r.customerId, r._sum.quantityCartons ?? 0]),
  );

  const balances = new Map<string, number>();
  for (const customerId of customerIds) {
    balances.set(
      customerId,
      Math.max(
        0,
        (ordered.get(customerId) ?? 0) - (loaded.get(customerId) ?? 0),
      ),
    );
  }
  return balances;
}
