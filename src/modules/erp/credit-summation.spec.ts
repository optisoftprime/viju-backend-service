import {
  ERP_ACCOUNT_BALANCE_FOR_CUSTOMER_SQL,
  ERP_ACCOUNT_BALANCES_FOR_CUSTOMERS_SQL,
  ERP_ACCOUNT_BALANCE_ROLLUP_SQL,
  ERP_CREDIT_IN_FORCE_SQL,
  ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL,
  runningBalanceFromCredit,
} from './account-balance';

/**
 * accountBalance = CREDIT_AMT + Σ(CREDIT_AMT1) − CREDIT_PAY
 *
 * CREDIT_AMT and CREDIT_PAY come from the GOVERNING record (newest by
 * EFFECTIVE_DATE). Σ(CREDIT_AMT1) sums every supplementary grant whose
 * effective window contains today — a customer can hold several at once, one
 * per FUND_DESC, and an expired one stops counting.
 */
describe('Account balance summation (Σ CREDIT_AMT1)', () => {
  describe('the arithmetic', () => {
    it('matches the ERP worked example for a single grant', () => {
      // ISEA INTEGRATED (10110017), the row quoted in the spec.
      expect(
        runningBalanceFromCredit({
          creditAmt: 1000.2222,
          creditAmt1: 1000.1111,
          creditPay: -33401031.14,
        }),
      ).toBe(33403031.4733);
    });

    it('sums several concurrent grants', () => {
      // The user's worked case: 1000.1111 + 2000.12 = 3000.2311
      expect(
        runningBalanceFromCredit({
          creditAmt: 1000.2222,
          creditAmt1: [1000.1111, 2000.12],
          creditPay: -33401031.14,
        }),
      ).toBe(1000.2222 + 3000.2311 + 33401031.14);
    });

    it('treats an empty grant list as zero, not as a missing balance', () => {
      // Every grant expired: the balance is simply CREDIT_AMT − CREDIT_PAY.
      expect(
        runningBalanceFromCredit({
          creditAmt: 50000,
          creditAmt1: [],
          creditPay: 0,
        }),
      ).toBe(50000);
    });

    it('ignores blanks and non-numerics inside the sum', () => {
      expect(
        runningBalanceFromCredit({
          creditAmt: 100,
          creditAmt1: [null, '', 'not-a-number', undefined, 25.5],
          creditPay: 0,
        }),
      ).toBe(125.5);
    });

    it('still accepts a bare value, so existing callers are unaffected', () => {
      expect(
        runningBalanceFromCredit({ creditAmt: 1, creditAmt1: 2, creditPay: 3 }),
      ).toBe(0);
    });

    it('does not round — every ERP decimal survives', () => {
      const v = runningBalanceFromCredit({
        creditAmt: 1000.2222,
        creditAmt1: [1000.1111],
        creditPay: -33401031.14,
      });
      expect(String(v)).toContain('.4733');
    });
  });

  describe('the SQL', () => {
    const balanceQueries = {
      'single customer': ERP_ACCOUNT_BALANCE_FOR_CUSTOMER_SQL,
      'batched customers': ERP_ACCOUNT_BALANCES_FOR_CUSTOMERS_SQL,
      'reconcile rollup': ERP_ACCOUNT_BALANCE_ROLLUP_SQL,
    };

    it.each(Object.entries(balanceQueries))(
      'the %s query SUMS CREDIT_AMT1 rather than reading one row',
      (_name, sql) => {
        expect(sql).toMatch(
          /sum\(coalesce\(nullif\(r\.payload->>'CREDIT_AMT1'/,
        );
      },
    );

    it.each(Object.entries(balanceQueries))(
      'the %s query gates the sum on the effective window',
      (_name, sql) => {
        expect(sql).toContain('current_date BETWEEN');
        expect(sql).toContain("'INEFFECTIVE_DATE')::date");
      },
    );

    it.each(Object.entries(balanceQueries))(
      'the %s query takes CREDIT_AMT and CREDIT_PAY from the governing record',
      (_name, sql) => {
        // Ordered newest-first and NOT gated by the window: gating these would
        // strand the 1,829 customers whose only record has expired.
        expect(sql).toContain("'EFFECTIVE_DATE' DESC NULLS LAST");
        const base = sql.slice(0, sql.indexOf('CREDIT_AMT1'));
        expect(base).toContain("'CREDIT_AMT'");
        expect(base).toContain("'CREDIT_PAY'");
        expect(base).not.toContain('current_date BETWEEN');
      },
    );

    it.each(Object.entries(balanceQueries))(
      'the %s query coalesces a missing sum to 0, never to null',
      (_name, sql) => {
        // A LEFT JOIN miss must yield CREDIT_AMT − CREDIT_PAY, not a NULL
        // balance that the caller would read as "no ERP figure".
        expect(sql).toMatch(/coalesce\(s\.credit_amt1_total, 0\)/);
      },
    );

    it('shares one window predicate with the temporary-credit query', () => {
      // The home screen shows `temporarilyCredit` beside the balance. If the
      // two used different windows the app would display a credit the balance
      // had not counted.
      expect(ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL).toContain(
        ERP_CREDIT_IN_FORCE_SQL,
      );
      for (const sql of Object.values(balanceQueries)) {
        expect(sql).toContain(ERP_CREDIT_IN_FORCE_SQL);
      }
    });

    it('guards malformed dates so one bad row cannot abort the query', () => {
      // String.raw keeps the single backslashes Postgres must receive: the
      // guard has to reach the server as \d, not as an escaped \d, or it
      // would match a literal backslash and silently exclude every row.
      const datePattern = String.raw`'^\d{4}-\d{2}-\d{2}'`;
      expect(ERP_CREDIT_IN_FORCE_SQL).toContain(
        `'EFFECTIVE_DATE'   ~ ${datePattern}`,
      );
      expect(ERP_CREDIT_IN_FORCE_SQL).toContain(
        `'INEFFECTIVE_DATE' ~ ${datePattern}`,
      );
    });
  });
});
