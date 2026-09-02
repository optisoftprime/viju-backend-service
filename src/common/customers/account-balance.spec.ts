import {
  balanceByErpId,
  balanceForCustomer,
  totalBalance,
} from './account-balance';

/**
 * One account-balance calculation, shared by every role.
 *
 * ISEA INTEGRATED is the live example: the stored column reads
 * -33,401,031.14 while the ERP credit feed states +33,403,031.47. The
 * projector copies raw CREDIT_PAY into that column, which inverts the sign for
 * every customer holding credit - so a screen reading the column tells an
 * officer the distributor is millions in debt when they are millions in credit.
 */
describe('Account balance, shared across the portal', () => {
  const ISEA = { erpId: '10110017', outstandingBalance: -33401031.14 };
  const DERIVED = 33403031.4733;

  const feed = (balances: Record<string, number>) => ({
    getRunningBalances: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(balances))),
  });

  it('prefers the ERP feed over the stored column', async () => {
    const erp = feed({ '10110017': DERIVED });

    const res = await balanceByErpId(erp as never, [ISEA]);

    expect(res.get('10110017')).toBe(DERIVED);
    expect(res.get('10110017')).not.toBe(ISEA.outstandingBalance);
  });

  it('gets the SIGN right, which is the whole point', async () => {
    const erp = feed({ '10110017': DERIVED });

    const res = await balanceByErpId(erp as never, [ISEA]);

    expect(res.get('10110017')).toBeGreaterThan(0);
    expect(ISEA.outstandingBalance).toBeLessThan(0);
  });

  it('falls back to the stored column when the feed is silent', async () => {
    // A fresh database or a customer with no credit record. Better the old
    // number than a zero the ERP never stated.
    const erp = feed({});

    const res = await balanceByErpId(erp as never, [ISEA]);

    expect(res.get('10110017')).toBe(ISEA.outstandingBalance);
  });

  it('reads a real zero from the feed as zero, not as silence', async () => {
    const erp = feed({ '10110017': 0 });

    const res = await balanceByErpId(erp as never, [ISEA]);

    expect(res.get('10110017')).toBe(0);
  });

  it('asks the feed once for the whole page', async () => {
    const page = Array.from({ length: 200 }, (_, i) => ({
      erpId: `1011${i}`,
      outstandingBalance: 0,
    }));
    const erp = feed({});

    await balanceByErpId(erp as never, page);

    expect(erp.getRunningBalances).toHaveBeenCalledTimes(1);
  });

  it('does not call the feed for an empty set', async () => {
    const erp = feed({});

    expect((await balanceByErpId(erp as never, [])).size).toBe(0);
    expect(erp.getRunningBalances).not.toHaveBeenCalled();
  });

  it('resolves a single customer the same way', async () => {
    const erp = feed({ '10110017': DERIVED });

    expect(await balanceForCustomer(erp as never, ISEA)).toBe(DERIVED);
  });

  describe('dashboard totals', () => {
    const ROWS = [
      ISEA,
      { erpId: '10110003', outstandingBalance: -1000 },
      { erpId: '10110084', outstandingBalance: 500 },
    ];

    it('sums the ERP figures, not the stored column', async () => {
      // Summing the column gave a total no individual screen agreed with.
      const erp = feed({ '10110017': 100, '10110003': 200, '10110084': 300 });

      expect(await totalBalance(erp as never, ROWS)).toBe(600);
    });

    it('mixes derived and stored where the feed is partial', async () => {
      // 100 from the feed + the two stored columns.
      const erp = feed({ '10110017': 100 });

      expect(await totalBalance(erp as never, ROWS)).toBe(100 - 1000 + 500);
    });

    it('is zero for an empty portfolio', async () => {
      expect(await totalBalance(feed({}) as never, [])).toBe(0);
    });
  });

  it('treats a null stored column as zero rather than NaN', async () => {
    // Unprojected admin rows carry nulls.
    const erp = feed({});

    const res = await balanceByErpId(erp as never, [
      { erpId: '99999999', outstandingBalance: null },
    ]);

    expect(res.get('99999999')).toBe(0);
  });
});
