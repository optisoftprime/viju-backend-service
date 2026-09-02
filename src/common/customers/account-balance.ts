import { ErpAccountBalanceService } from '../../modules/erp/erp-account-balance.service';

/** The minimum a row must carry to have its balance resolved. */
export interface BalanceRow {
  erpId: string;
  outstandingBalance: number | null;
}

/**
 * The account balance to show for a set of customers.
 *
 * ─── One formula everywhere ─────────────────────────────────────────────
 *
 * This is THE calculation behind every balance the product shows, whoever is
 * looking: the distributor's own `accountBalance` on GET /customers/me/home
 * and `outstandingBalance` on GET /customers/me, the `walletBalance` column
 * and tabs across the officer portal, and `outstandingBalance` on the admin
 * and regional customer lists, details, dashboards and CSV export.
 *
 * It is derived live from the ERP customer-credit feed:
 *
 *   CREDIT_AMT + CREDIT_AMT1 - CREDIT_PAY
 *
 * NOT from the stored `Customer.outstandingBalance` column. The projector that
 * writes that column copies the ERP's raw CREDIT_PAY into it, which INVERTS
 * THE SIGN for every customer holding credit - ISEA INTEGRATED reads
 * -33,401,031.14 stored against a true +33,403,031.47. An officer and the
 * distributor looking at the same account would disagree about whether it was
 * in credit or in debt.
 *
 * ─── The fallback ───────────────────────────────────────────────────────
 *
 * The stored column stands in when the ERP feed is absent (CI, a fresh local
 * database) or holds no credit record for that customer, so a screen keeps
 * showing a number rather than a zero the ERP never stated. A customer the
 * feed genuinely reports as zero comes back as a real zero.
 *
 * One query for the whole set, so a page of 200 costs the same as a page of 20.
 *
 * Returns a map keyed by `erpId`, with an entry for every row passed in.
 */
export async function balanceByErpId(
  accountBalance: ErpAccountBalanceService,
  rows: BalanceRow[],
): Promise<Map<string, number>> {
  if (rows.length === 0) return new Map();
  const derived = await accountBalance.getRunningBalances(
    rows.map((r) => r.erpId),
  );
  return new Map(
    rows.map((r) => [
      r.erpId,
      derived.get(r.erpId) ?? r.outstandingBalance ?? 0,
    ]),
  );
}

/** The same, for a single customer. */
export async function balanceForCustomer(
  accountBalance: ErpAccountBalanceService,
  row: BalanceRow,
): Promise<number> {
  return (await balanceByErpId(accountBalance, [row])).get(row.erpId) ?? 0;
}

/**
 * Sums the balances of a set of customers, ERP-derived.
 *
 * For the dashboard tiles, which used to add up the stored column and so
 * reported a total no individual screen agreed with - and one whose sign was
 * wrong for every customer in credit.
 */
export async function totalBalance(
  accountBalance: ErpAccountBalanceService,
  rows: BalanceRow[],
): Promise<number> {
  const balances = await balanceByErpId(accountBalance, rows);
  let total = 0;
  for (const row of rows) total += balances.get(row.erpId) ?? 0;
  return total;
}
