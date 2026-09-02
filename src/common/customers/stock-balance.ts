import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CustomerStock,
  ErpStockBalanceService,
} from '../../modules/erp/erp-stock-balance.service';

/**
 * A customer's stock position for the customer LISTS.
 *
 * ─── One formula everywhere ─────────────────────────────────────────────
 *
 * These are the STOCK columns on GET /admin/customers,
 * GET /admin/customers/{id}, GET /regional/customers and
 * GET /officers/customers. They report the SAME figures the distributor sees
 * on GET /customers/me/stock-balance and their home screen, because they are
 * computed by the same ERP query with the same filters:
 *
 *   totalStock           SUM(BUSINESS_QTY1)
 *   stockLoaded          SUM(DELIVERED_BUSINESS_QTY)
 *   stockBalanceCartons  the difference, floored at zero
 *
 *   ... WHERE CLOSE = '0' AND ApproveStatus = 'Y'
 *
 * WHY THIS CHANGED: `stockBalanceCartons` used to be
 * `SUM(PurchaseItem.quantity)` minus completed loading requests, read from the
 * LOCAL tables. The projector copies order lines for barely any order - ADLAK
 * has 4,901 orders and 20 PurchaseItem rows - so the column read 1,760 while
 * that same distributor's own screen showed 5,852.
 *
 * ─── The fallback ───────────────────────────────────────────────────────
 *
 * The local calculation survives for customers the ERP feed says nothing
 * about, and for a database without the feed at all. It is not the same
 * formula and cannot be - it has no CLOSE or ApproveStatus to filter on - but
 * "the old approximate figure" beats "0" for a customer the ERP has never
 * heard of.
 *
 * One ERP query for the whole page, so a page of 200 costs the same as a page
 * of 20; the local fallback runs only for the customers the ERP could not
 * answer for, and not at all when it answered for everyone.
 *
 * Returns a map keyed by customer id. A customer absent from the map has no
 * stock figures at all, which callers read as zeros.
 */
export async function stockByCustomer(
  prisma: PrismaService,
  customers: { id: string; erpId: string }[],
  stockBalance?: ErpStockBalanceService,
): Promise<Map<string, CustomerStock>> {
  const balances = new Map<string, CustomerStock>();
  if (customers.length === 0) return balances;

  // The ERP first, for every customer at once.
  const fromErp = stockBalance
    ? await stockBalance.stockByErpId(customers.map((c) => c.erpId))
    : new Map<string, CustomerStock>();

  const unknown: string[] = [];
  for (const customer of customers) {
    const stock = fromErp.get(customer.erpId);
    if (stock) balances.set(customer.id, stock);
    else unknown.push(customer.id);
  }
  if (unknown.length === 0) return balances;

  // Only the customers the ERP could not answer for reach the local tables.
  const [orderedRows, loadedRows] = await Promise.all([
    prisma.$queryRaw<{ customerId: string; qty: number }[]>`
        SELECT p."customerId" AS "customerId",
               COALESCE(SUM(i.quantity), 0)::int AS qty
          FROM "PurchaseItem" i
          JOIN "Purchase" p ON p.id = i."purchaseId"
         WHERE p."customerId" = ANY(${unknown})
         GROUP BY 1`,
    prisma.loadingRequest.groupBy({
      by: ['customerId'],
      where: { customerId: { in: unknown }, status: 'COMPLETED' },
      _sum: { quantityCartons: true },
    }),
  ]);

  const ordered = new Map(orderedRows.map((r) => [r.customerId, r.qty]));
  const loaded = new Map(
    loadedRows.map((r) => [r.customerId, r._sum.quantityCartons ?? 0]),
  );
  for (const customerId of unknown) {
    const totalStock = ordered.get(customerId) ?? 0;
    const stockLoaded = loaded.get(customerId) ?? 0;
    balances.set(customerId, {
      totalStock,
      stockLoaded,
      stockBalanceCartons: Math.max(0, totalStock - stockLoaded),
    });
  }
  return balances;
}
