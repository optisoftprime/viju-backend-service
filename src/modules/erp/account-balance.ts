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
 *                   paylotemporarily credit ad — the ERP has already resolved whatever rate rules
 *                   (AR_RATE, SD_RATE, SO_RATE, ADV_RATE …) feed it, so it is
 *                   summed as-is and never re-derived here.
 *   CREDIT_PAY      credit consumed. POSITIVE means consumed/owing, NEGATIVE
 *                   means the customer is in credit — which is why it is
 *                   SUBTRACTED rather than copied.
 *   EFFECTIVE_DATE  orders the credit records; the newest one governs.
 *
 * ─── The formula ────────────────────────────────────────────────────────
 *
 *   Running Balance = CREDIT_AMT + Σ(CREDIT_AMT1) − CREDIT_PAY
 *
 * CREDIT_AMT and CREDIT_PAY are read from the GOVERNING record - the newest by
 * EFFECTIVE_DATE. Σ(CREDIT_AMT1) sums every supplementary grant whose
 * EFFECTIVE_DATE..INEFFECTIVE_DATE window contains TODAY, across all of the
 * customer's records: a customer can hold several concurrent allocations, one
 * per FUND_DESC, and an expired one stops counting.
 *
 * The window gates ONLY the CREDIT_AMT1 term. Gating the whole record would
 * strand almost every customer: 1,829 of the 1,831 records in the feed have
 * already expired, so they would lose their derived balance entirely and fall
 * back to the inverted stored column this file exists to correct.
 *
 * Because the window is evaluated against today, a balance can legitimately
 * move with no change in the feed - the day a grant's INEFFECTIVE_DATE passes,
 * it drops out.
 *
 * Worked against live rows (Σ counts only grants in force TODAY):
 *
 *   10110017  ISEA        1000.2222 + 1000.1111 − (−33401031.14)
 *                                                     = 33,403,031.4733  in credit
 *                         its grant runs 2026-08-10 → 2026-09-05, so it counts
 *
 *   10110003  ADLAK             0 + 10000.2345 − (−10140600.1232)
 *                                                     = 10,150,600.3577  in credit
 *
 *   20410008  GLO-BARTH     50000 +         0 −         0  =  50,000     in credit
 *                         its 20,000 grant has EXPIRED, so it no longer counts
 *                         (it did under the previous single-record formula)
 *
 *   10120003  SALES3            0 +         0 −    866000  = −866,000     overdrawn
 *                         its 500,000 grant has likewise expired
 *
 * Switching from the governing record's CREDIT_AMT1 to Σ moves 12 of the 1,831
 * customers in the feed — in every case an expired grant dropping out. Row
 * count is unchanged, so no customer loses their derived balance.
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
        coalesce(nullif(r.payload->>'CREDIT_AMT', '')::numeric, 0)
      - coalesce(nullif(r.payload->>'CREDIT_PAY', '')::numeric, 0)`;

/**
 * The window test that decides whether a CREDIT_AMT1 grant counts today.
 *
 * ONE definition, shared by the balance and by
 * ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL, so the `temporarilyCredit` figure the
 * home screen shows is by construction the same money the balance already
 * includes. If these two ever diverged the app would display a credit the
 * balance did not account for.
 *
 * Comparison is by DATE: the ERP stores midnight on both ends, so
 * INEFFECTIVE_DATE is the last day the grant applies, inclusive. The `~`
 * guards make a malformed date skip its row rather than abort the query - this
 * feeds the mobile home screen, which must not 500 because the ERP sent one
 * bad date. The `0001-01-01` sentinel on expired rows fails the BETWEEN
 * naturally, so it needs no special case.
 */
export const ERP_CREDIT_IN_FORCE_SQL = `
       AND r.payload->>'EFFECTIVE_DATE'   ~ '^\\d{4}-\\d{2}-\\d{2}'
       AND r.payload->>'INEFFECTIVE_DATE' ~ '^\\d{4}-\\d{2}-\\d{2}'
       AND current_date BETWEEN (r.payload->>'EFFECTIVE_DATE')::date
                            AND (r.payload->>'INEFFECTIVE_DATE')::date`;

/**
 * Sum of every CREDIT_AMT1 grant in force for a customer today.
 *
 * A customer may hold several concurrent grants (one per FUND_DESC), so this
 * is a SUM across rows rather than a value read off the governing record.
 * Joined onto the balance queries below; a customer with no live grant simply
 * does not appear here and coalesces to 0.
 */
export const ERP_SUPPLEMENTARY_CREDIT_SQL = `
    SELECT r.payload->>'CUSTOMER_CODE' AS erp_id,
           sum(coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0))
             AS credit_amt1_total
      FROM erp_raw.raw_customer_credit r
     WHERE r.object_type = 'CUSTOMER_CREDIT'${ERP_CREDIT_IN_FORCE_SQL}
     GROUP BY 1`;

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
    WITH governing AS (
      SELECT DISTINCT ON (r.payload->>'CUSTOMER_CODE')
             r.payload->>'CUSTOMER_CODE' AS erp_id,
             ${ERP_RUNNING_BALANCE_SQL}  AS base_balance,
             r.changed_at                AS changed_at
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' IN (SELECT "erpId" FROM "Customer")
       ORDER BY r.payload->>'CUSTOMER_CODE',
                r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
                r.id DESC
    ),
    supplementary AS (${ERP_SUPPLEMENTARY_CREDIT_SQL})
    SELECT g.erp_id                                     AS erp_id,
           g.base_balance + coalesce(s.credit_amt1_total, 0)
                                                        AS running_balance,
           g.changed_at                                 AS changed_at
      FROM governing g
      LEFT JOIN supplementary s ON s.erp_id = g.erp_id`;

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
    WITH governing AS (
      SELECT ${ERP_RUNNING_BALANCE_SQL} AS base_balance
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' = $1
       ORDER BY r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
                r.id DESC
       LIMIT 1
    ),
    supplementary AS (
      SELECT coalesce(
               sum(coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0)),
               0
             ) AS credit_amt1_total
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' = $1${ERP_CREDIT_IN_FORCE_SQL}
    )
    SELECT g.base_balance + coalesce(s.credit_amt1_total, 0) AS running_balance
      FROM governing g
      CROSS JOIN supplementary s`;

/**
 * Running balances for a SET of customers, by ERP code.
 *
 * The same rollup as the single-customer query, batched: one round trip for a
 * whole page instead of one per row. Every list endpoint that shows a balance
 * goes through this, so the figure on a table row is the same number the
 * customer's own profile reports.
 *
 * Like the single-customer query it is not restricted to projected customers,
 * and an ERP code with no credit record simply does not come back — the caller
 * falls back to the stored column rather than inventing a zero.
 */
export const ERP_ACCOUNT_BALANCES_FOR_CUSTOMERS_SQL = `
    WITH governing AS (
      SELECT DISTINCT ON (r.payload->>'CUSTOMER_CODE')
             r.payload->>'CUSTOMER_CODE' AS erp_id,
             ${ERP_RUNNING_BALANCE_SQL}  AS base_balance
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' = ANY($1)
       ORDER BY r.payload->>'CUSTOMER_CODE',
                r.payload->>'EFFECTIVE_DATE' DESC NULLS LAST,
                r.id DESC
    ),
    supplementary AS (
      SELECT r.payload->>'CUSTOMER_CODE' AS erp_id,
             sum(coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0))
               AS credit_amt1_total
        FROM erp_raw.raw_customer_credit r
       WHERE r.object_type = 'CUSTOMER_CREDIT'
         AND r.payload->>'CUSTOMER_CODE' = ANY($1)${ERP_CREDIT_IN_FORCE_SQL}
       GROUP BY 1
    )
    SELECT g.erp_id AS erp_id,
           g.base_balance + coalesce(s.credit_amt1_total, 0) AS running_balance
      FROM governing g
      LEFT JOIN supplementary s ON s.erp_id = g.erp_id`;

/**
 * Temporary (supplementary) credit currently in force for one customer.
 *
 * `CREDIT_AMT1` is credit the ERP grants for a FIXED WINDOW - EFFECTIVE_DATE to
 * INEFFECTIVE_DATE - under a FUND_DESC such as 铺底 (floor stock) or 老板特批
 * (boss special approval). Only 13 of 1,831 rows carry a real window; the rest
 * hold the sentinel `0001-01-01`, which no `current_date` can fall between, so
 * they contribute nothing without needing a special case.
 *
 * Comparison is by DATE, not timestamp: the ERP stores midnight on both ends,
 * so INEFFECTIVE_DATE is treated as the last day the credit applies, inclusive.
 *
 * Every row for the customer is summed, not just the newest - a customer may
 * hold several concurrent grants.
 *
 * The `~` guards make a malformed date skip its row rather than abort the
 * query: this feeds the mobile home screen, which must not 500 because the ERP
 * sent one bad date.
 */
export const ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL = `
    SELECT coalesce(
             sum(coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0)),
             0
           ) AS temporary_credit
      FROM erp_raw.raw_customer_credit r
     WHERE r.object_type = 'CUSTOMER_CREDIT'
       AND r.payload->>'CUSTOMER_CODE' = $1${ERP_CREDIT_IN_FORCE_SQL}`;

/**
 * Running balance from three already-parsed field values.
 *
 * The SQL above is what runs in production; this is the same formula in TS for
 * callers holding a decoded payload (the push webhook, tests). Non-finite and
 * missing values count as zero, matching the `coalesce` in the SQL.
 *
 * Like the SQL, the result is returned unrounded.
 */
type CreditValue = number | string | null | undefined;

export function runningBalanceFromCredit(fields: {
  creditAmt?: CreditValue;
  /**
   * One grant, or every grant in force. An array is SUMMED, matching
   * Σ(CREDIT_AMT1) in the SQL - a customer can hold several concurrent
   * supplementary allocations, one per FUND_DESC.
   */
  creditAmt1?: CreditValue | CreditValue[];
  creditPay?: CreditValue;
}): number {
  const n = (v: CreditValue): number => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string' && v.trim() === '') return 0;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const sum = (v: CreditValue | CreditValue[]): number =>
    Array.isArray(v)
      ? v.reduce<number>((total, one) => total + n(one), 0)
      : n(v);

  // Returned exactly as the sum produces it — no rounding, so every decimal
  // the ERP supplied survives.
  return n(fields.creditAmt) + sum(fields.creditAmt1) - n(fields.creditPay);
}
