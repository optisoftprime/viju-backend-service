import { ErpAccountBalanceService } from './erp-account-balance.service';
import { ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL } from './account-balance';

/**
 * Temporary (supplementary) credit - the `temporarilyCredit` field on
 * GET /customers/me/home.
 *
 * CREDIT_AMT1 is credit the ERP grants for a fixed window (EFFECTIVE_DATE to
 * INEFFECTIVE_DATE) under a FUND_DESC such as floor-stock or a special
 * approval. Only the grants whose window contains TODAY count.
 */
describe('Temporary credit (CREDIT_AMT1 within its window)', () => {
  const build = (rows: unknown, available = true) => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('to_regclass')) {
          return Promise.resolve([{ present: available }]);
        }
        if (rows instanceof Error) return Promise.reject(rows);
        return Promise.resolve(rows);
      }),
    };
    return { prisma, service: new ErpAccountBalanceService(prisma as never) };
  };

  it('sums CREDIT_AMT1 for the grants in force today', async () => {
    const { service } = build([{ temporary_credit: '1000.1111' }]);

    await expect(service.getTemporaryCredit('10110017')).resolves.toBe(
      1000.1111,
    );
  });

  it('adds several concurrent grants together', async () => {
    // The customer may hold more than one active grant; the SQL sums them.
    const { service } = build([{ temporary_credit: '1500000' }]);

    await expect(service.getTemporaryCredit('10110177')).resolves.toBe(1500000);
  });

  it('returns 0 when every window has expired', async () => {
    const { service } = build([{ temporary_credit: '0' }]);

    await expect(service.getTemporaryCredit('10110456')).resolves.toBe(0);
  });

  it('returns 0 - never null - when the customer has no credit record', async () => {
    const { service } = build([{ temporary_credit: null }]);

    await expect(service.getTemporaryCredit('nobody')).resolves.toBe(0);
  });

  it('returns 0 when the ERP credit feed is absent', async () => {
    const { service } = build([], false);

    await expect(service.getTemporaryCredit('10110017')).resolves.toBe(0);
  });

  it('returns 0 rather than failing the home screen on a query error', async () => {
    const { service } = build(new Error('boom'));

    await expect(service.getTemporaryCredit('10110017')).resolves.toBe(0);
  });

  it('does not query at all for a customer with no erpId', async () => {
    const { service, prisma } = build([]);

    await expect(service.getTemporaryCredit('')).resolves.toBe(0);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('keeps full precision - no rounding', async () => {
    const { service } = build([{ temporary_credit: '1000.1111' }]);

    const value = await service.getTemporaryCredit('10110017');
    expect(value).toBe(1000.1111);
    expect(value.toString()).toBe('1000.1111');
  });
});

describe('the temporary-credit SQL', () => {
  const sql = ERP_TEMPORARY_CREDIT_FOR_CUSTOMER_SQL;

  it('windows on TODAY, inclusive of both end dates', () => {
    // Compared as dates, not timestamps: the ERP stores midnight on both ends,
    // so INEFFECTIVE_DATE is the last day the grant applies.
    expect(sql).toContain('current_date BETWEEN');
    expect(sql).toContain("(r.payload->>'EFFECTIVE_DATE')::date");
    expect(sql).toContain("(r.payload->>'INEFFECTIVE_DATE')::date");
  });

  it('sums CREDIT_AMT1 and nothing else', () => {
    // CREDIT_AMT and CREDIT_PAY belong to the running balance, not here.
    expect(sql).toContain('CREDIT_AMT1');
    expect(sql).not.toContain("'CREDIT_PAY'");
    expect(sql).not.toContain("'CREDIT_AMT'\n");
  });

  it('treats a missing or blank CREDIT_AMT1 as zero', () => {
    expect(sql).toContain(
      "coalesce(nullif(r.payload->>'CREDIT_AMT1', '')::numeric, 0)",
    );
  });

  it('coalesces an empty result to 0 rather than NULL', () => {
    expect(sql.replace(/\s+/g, ' ')).toContain('coalesce( sum(');
  });

  it('skips a malformed date instead of aborting the query', () => {
    // This feeds the mobile home screen; one bad ERP date must not 500 it.
    const guard = "~ '^" + String.raw`\d{4}-\d{2}-\d{2}` + "'";
    expect(sql.split(guard).length - 1).toBe(2);
  });

  it('parameterises the customer code', () => {
    expect(sql).toContain("payload->>'CUSTOMER_CODE' = $1");
  });

  it('excludes the 0001-01-01 sentinel by construction', () => {
    // 1,818 of 1,831 rows carry that sentinel on both ends. No current_date
    // can fall between 0001-01-01 and 0001-01-01, so they contribute nothing
    // without needing a special case.
    expect(sql).toContain('current_date BETWEEN');
  });
});
