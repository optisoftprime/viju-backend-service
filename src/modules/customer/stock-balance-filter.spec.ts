import { CustomerService } from './customer.service';

/**
 * GET /customers/me/stock-balance
 *
 * A product the distributor has collected in full is not part of a "stock
 * balance", so it drops out of `products` — while still counting towards the
 * totals, which describe the whole order history.
 */
describe('Stock balance product filtering', () => {
  const build = (erpProducts: unknown[] | null) => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c-1', erpId: '101' }),
      },
      purchase: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const stockBalance = {
      getStockBalance: jest.fn().mockResolvedValue(
        erpProducts === null
          ? null
          : {
              totalPurchasedCartons: 700,
              totalLoadedCartons: 280,
              totalRemainingCartons: 420,
              products: erpProducts,
            },
      ),
    };
    return new CustomerService(
      prisma as never,
      {} as never,
      {} as never,
      stockBalance as never,
      {} as never,
      {} as never,
      {} as never,
    );
  };

  const product = (
    name: string,
    remaining: number,
    itemCode = '101020104',
  ) => ({
    itemCode,
    productName: name,
    quantityPaid: 100,
    quantityLoaded: 100 - remaining,
    quantityRemaining: remaining,
  });

  it('drops fully collected products from the list', async () => {
    const svc = build([
      product('Viju Chivita 1L', 40),
      product('Viju Wheat Milk', 0),
      product('750ml Water', 12),
    ]);

    const res = await svc.getStockBalanceBreakdown('c-1');

    expect(res.products.map((p) => p.productName)).toEqual([
      'Viju Chivita 1L',
      '750ml Water',
    ]);
  });

  it('leaves the totals describing the whole history', async () => {
    // Deliberate: `products` no longer sums to `totalPurchasedCartons`.
    const svc = build([product('A', 0), product('B', 40)]);

    const res = await svc.getStockBalanceBreakdown('c-1');

    expect(res.totalPurchasedCartons).toBe(700);
    expect(res.totalLoadedCartons).toBe(280);
    expect(res.totalRemainingCartons).toBe(420);
  });

  it('returns an empty array when everything has been collected', async () => {
    const svc = build([product('A', 0), product('B', 0)]);

    const res = await svc.getStockBalanceBreakdown('c-1');

    expect(res.products).toEqual([]);
    // Still non-zero totals — the distributor did buy, and has taken it all.
    expect(res.totalPurchasedCartons).toBe(700);
  });

  it('carries the ERP item code through', async () => {
    const svc = build([product('Viju Chivita 1L', 40, '101020104')]);

    const res = await svc.getStockBalanceBreakdown('c-1');

    expect(res.products[0].itemCode).toBe('101020104');
  });

  it('applies the same rule on the local fallback path', async () => {
    // No ERP feed: the breakdown is built from projected purchases instead,
    // and must not start including zero rows just because the source differs.
    const svc = build(null);

    const res = await svc.getStockBalanceBreakdown('c-1');

    expect(res.products).toEqual([]);
  });
});
