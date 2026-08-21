/**
 * The single ERP → account-balance mapping.
 *
 * WHY THIS EXISTS: `Customer.outstandingBalance` is written by a projector
 * that lives in another service, and that projector copies the ERP's raw
 * `CREDIT_PAY` field straight into the column. `CREDIT_PAY` is the credit the
 * customer has CONSUMED, signed from the ERP's point of view — so copying it
 * verbatim inverts the balance for every customer holding credit. On the
 * current feed that is 1,473 of 1,831 customers (80%): ISEA INTEGRATED
 * (10110017) reads −33,401,031.14 ("owes ₦33.4m") when the ERP in fact has it
 * 33.4m in credit.
 *
 * ─── Field mapping: erp_raw.raw_customer_credit ─────────────────────────
 *
 *   CUSTOMER_CODE   joins to Customer.erpId
 *   CREDIT_AMT      standard approved credit limit
 *   CREDIT_AMT1     supplementary credit allocation, granted per FUND_DESC
 *                   (铺底 "floor-stock" credit, 老板特批 "boss special
 *                   approval", …). Non-zero on only 13 of 1,831 rows; equal to
 *                   CREDIT_AMT on 1,801 of them. It is a plain numeric on the
 *                   payload — the ERP has already resolved whatever rate rules
 *                   (AR_RATE, SD_RATE, SO_RATE, ADV_RATE …) feed it, so it is
 *                   summed as-is and never re-derived here.
 *   CREDIT_PAY      credit consumed. POSITIVE means consumed/owing, NEGATIVE
 *                   means the customer is in credit — which is why it is
 *                   SUBTRACTED rather than copied.
 *   EFFECTIVE_DATE  orders the credit records; the newest one governs.
 *
 * ─── The formula ────────────────────────────────────────────────────────
 *
 *   Running Balance = CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY
 *
 * Worked against live rows:
 *
 *   20410008  GLO-BARTH   50000 +   20000 −         0  =      70,000     in credit
 *   10120003  SALES3          0 +  500000 −    866000  =    −366,000     overdrawn
 *   10110017  ISEA        1000.2222 + 1000.1111 − (−33401031.14)
 *                                                     = 33,403,031.4733  in credit
 *
 * The result is NOT rounded: every decimal the ERP supplies survives into the
 * balance, so the last example ends .4733 rather than .47.
 *
 * The sign that falls out matches what the portal already assumes everywhere:
 * NEGATIVE = overdrawn/owing (`isLow`, `isOverdue`, the officer overdue
 * filter), POSITIVE = funds available.
 */

/**
 * Running balance for one credit record, as SQL.
 *
 * Every term is `coalesce(nullif(…, '')::numeric, 0)` so a missing or blank
 * field contributes zero instead of turning the whole balance into NULL — the
 * ERP leaves CREDIT_AMT1 empty far more often than it sets it.
 *
 * NOT ROUNDED. The ERP carries up to 4dp on the credit fields (1000.2222), and
 * the balance keeps every one of those decimals exactly as the sum produces
 * them — ISEA INTEGRATED lands on 33403031.4733, not 33403031.47. The
 * arithmetic runs in `numeric`, so it is exact decimal maths rather than
 * binary floating point, and only the final store into the DOUBLE PRECISION
 * column casts to float8.
 */
export const ERP_RUNNING_BALANCE_SQL = `
        coalesce(nullif(r.payload->>'CREDIT_AMT',  '')::numeric, 0)
      + coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0)
      - coalesce(nullif(r.payload->>'CREDIT_PAY',  '')::numeric, 0)`;

/**
 * The governing credit record per customer, with its running balance.
 *
 * The feed currently holds exactly one row per customer (1,831 rows, 1,831
 * distinct CUSTOMER_CODEs), but `DISTINCT ON` keeps this correct if the ERP
 * ever starts versioning credit records by EFFECTIVE_DATE — the newest wins,
 * with `id` breaking ties on identical dates. This mirrors how
 * `ErpRawService.getCreditLimit` already picks a credit row.
 *
 * Restricted to customers we actually hold, so this stays an index lookup
 * rather than a scan of the whole credit feed.
 */
export const ERP_ACCOUNT_BALANCE_ROLLUP_SQL = `
    SELECT DISTINCT ON (r.payload->>'CUSTOMER_CODE')
           r.payload->>'CUSTOMER_CODE' AS erp_id,
           ${ERP_RUNNING_BALANCE_SQL}  AS running_balance,
           r.changed_at                AS changed_at
      FROM erp_raw.raw_customer_credit r
     WHERE r.object_type = 'CUSTOMER_CREDIT'
       AND r.payload->>'CUSTOMER_CODE' IN (SELECT "erpId" FROM "Customer")
     ORDER BY r.payload->>'CUSTOMER_CODE',
              r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
              r.id DESC`;

/**
 * The whole reconcile as one set-based statement.
 *
 * `updatedAt` moves only when the balance actually changes, and is stamped
 * with the ERP row's own `changed_at` rather than "now" — the app surfaces
 * that column as the balance's `lastUpdated`, so it should say when the
 * BALANCE moved, not when we last looked. Customers with no credit record in
 * the feed are left exactly as they are rather than being zeroed.
 */
export const ERP_ACCOUNT_BALANCE_RECONCILE_SQL = `
WITH derived AS (${ERP_ACCOUNT_BALANCE_ROLLUP_SQL})
UPDATE "Customer" c
   SET "outstandingBalance" = d.running_balance::float8,
       "updatedAt"          = coalesce(d.changed_at, now())
  FROM derived d
 WHERE c."erpId" = d.erp_id
   AND c."outstandingBalance" IS DISTINCT FROM d.running_balance::float8`;

/**
 * Running balance for a single customer, by ERP code.
 *
 * Same rollup as the reconcile, without the `IN (SELECT …)` restriction, so it
 * answers for an ERP customer that has not been projected into `Customer` yet.
 */
export const ERP_ACCOUNT_BALANCE_FOR_CUSTOMER_SQL = `
    SELECT ${ERP_RUNNING_BALANCE_SQL} AS running_balance
      FROM erp_raw.raw_customer_credit r
     WHERE r.object_type = 'CUSTOMER_CREDIT'
       AND r.payload->>'CUSTOMER_CODE' = $1
     ORDER BY r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
              r.id DESC
     LIMIT 1`;

/**
 * Running balance from three already-parsed field values.
 *
 * The SQL above is what runs in production; this is the same formula in TS for
 * callers holding a decoded payload (the push webhook, tests). Non-finite and
 * missing values count as zero, matching the `coalesce` in the SQL.
 *
 * Like the SQL, the result is returned unrounded.
 */
export function runningBalanceFromCredit(fields: {
  creditAmt?: number | string | null;
  creditAmt1?: number | string | null;
  creditPay?: number | string | null;
}): number {
  const n = (v: number | string | null | undefined): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string' && v.trim() === '') return 0;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  // Returned exactly as the sum produces it — no rounding, so every decimal
  // the ERP supplied survives.
  return n(fields.creditAmt) + n(fields.creditAmt1) - n(fields.creditPay);
}
