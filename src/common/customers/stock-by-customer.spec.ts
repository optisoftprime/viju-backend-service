import { stockByCustomer } from './stock-balance';

/**
 * The STOCK columns on the admin, regional and officer customer lists.
 *
 * They must report the same figures the distributor sees on their own screen,
 * so they read the ERP with the same filters rather than the local tables -
 * which the projector barely populates. ADLAK is the live example throughout:
 * the local tables said 1,760 cartons outstanding while the distributor's own
 * screen said 5,852.
 */
describe('Stock columns on the customer lists', () => {
  const ADLAK = { id: 'c-1', erpId: '10110003' };
  const ERP_FIGURES = {
    totalStock: 39765,
    stockLoaded: 33913,
    stockBalanceCartons: 5852,
  };

  const build = (erp: Record<string, unknown> | null) => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ customerId: 'c-1', qty: 2349 }]),
      loadingRequest: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { customerId: 'c-1', _sum: { quantityCartons: 589 } },
          ]),
      },
    };
    const stockBalance = {
      stockByErpId: jest
        .fn()
        .mockResolvedValue(erp ? new Map(Object.entries(erp)) : new Map()),
    };
    return { prisma, stockBalance };
  };

  it('reports the ERP figures, not the local tables', async () => {
    const { prisma, stockBalance } = build({ '10110003': ERP_FIGURES });

    const res = await stockByCustomer(
      prisma as never,
      [ADLAK],
      stockBalance as never,
    );

    expect(res.get('c-1')).toEqual(ERP_FIGURES);
    // 2,349 - 589 = 1,760 was the old answer. It must not appear.
    expect(res.get('c-1')?.stockBalanceCartons).not.toBe(1760);
  });

  it('does not touch the local tables when the ERP answered', async () => {
    const { prisma, stockBalance } = build({ '10110003': ERP_FIGURES });

    await stockByCustomer(prisma as never, [ADLAK], stockBalance as never);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.loadingRequest.groupBy).not.toHaveBeenCalled();
  });

  it('asks the ERP once for the whole page', async () => {
    // A page of 200 must cost the same as a page of 20.
    const page = Array.from({ length: 200 }, (_, i) => ({
      id: `c-${i}`,
      erpId: `1011${i}`,
    }));
    const { prisma, stockBalance } = build({});

    await stockByCustomer(prisma as never, page, stockBalance as never);

    expect(stockBalance.stockByErpId).toHaveBeenCalledTimes(1);
    expect(stockBalance.stockByErpId).toHaveBeenCalledWith(
      page.map((c) => c.erpId),
    );
  });

  it('falls back locally only for customers the ERP cannot answer for', async () => {
    // "The ERP has never heard of them" is not "they hold nothing".
    const { prisma, stockBalance } = build({});

    const res = await stockByCustomer(
      prisma as never,
      [ADLAK],
      stockBalance as never,
    );

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(res.get('c-1')).toEqual({
      totalStock: 2349,
      stockLoaded: 589,
      stockBalanceCartons: 1760,
    });
  });

  it('splits the page between the two sources', async () => {
    const known = { id: 'c-1', erpId: '10110003' };
    const stranger = { id: 'c-2', erpId: '99999999' };
    const { prisma, stockBalance } = build({ '10110003': ERP_FIGURES });
    prisma.$queryRaw.mockResolvedValue([{ customerId: 'c-2', qty: 100 }]);
    prisma.loadingRequest.groupBy.mockResolvedValue([]);

    const res = await stockByCustomer(
      prisma as never,
      [known, stranger],
      stockBalance as never,
    );

    expect(res.get('c-1')).toEqual(ERP_FIGURES);
    expect(res.get('c-2')).toEqual({
      totalStock: 100,
      stockLoaded: 0,
      stockBalanceCartons: 100,
    });
    // Only the stranger was looked up locally.
    expect(
      prisma.loadingRequest.groupBy.mock.calls[0][0].where.customerId,
    ).toEqual({ in: ['c-2'] });
  });

  it('reads a real zero from the ERP as zero, not as unknown', async () => {
    // A distributor the ERP knows, holding nothing outstanding.
    const { prisma, stockBalance } = build({
      '10110003': { totalStock: 0, stockLoaded: 0, stockBalanceCartons: 0 },
    });

    const res = await stockByCustomer(
      prisma as never,
      [ADLAK],
      stockBalance as never,
    );

    expect(res.get('c-1')?.stockBalanceCartons).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('works without the ERP service at all', async () => {
    // A database with no feed: the old figure stands rather than zeros.
    const { prisma } = build(null);

    const res = await stockByCustomer(prisma as never, [ADLAK]);

    expect(res.get('c-1')?.stockBalanceCartons).toBe(1760);
  });

  it('does nothing for an empty page', async () => {
    const { prisma, stockBalance } = build({});

    const res = await stockByCustomer(
      prisma as never,
      [],
      stockBalance as never,
    );

    expect(res.size).toBe(0);
    expect(stockBalance.stockByErpId).not.toHaveBeenCalled();
  });
});
