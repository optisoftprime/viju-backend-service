import { ErpStockBalanceService } from './erp-stock-balance.service';
import {
  ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL,
  ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL,
} from './stock-balance';

/**
 * Stock balance from the ERP sales-order feed:
 *
 *   Stock Balance = SUM(BUSINESS_QTY1 - DELIVERED_BUSINESS_QTY)
 *                   WHERE CLOSE = '0' AND ApproveStatus = 'Y'
 *
 * One source shared by GET /customers/me/home and
 * GET /customers/me/stock-balance, which previously computed it two different
 * ways and disagreed.
 */
describe('ERP stock balance', () => {
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
    const itemCodes = { codeFor: () => null };
    return {
      prisma,
      service: new ErpStockBalanceService(prisma as never, itemCodes as never),
    };
  };

  it('sums ordered minus delivered across every line', async () => {
    const { service } = build([
      {
        product: 'WATER 750ml',
        ordered_qty: '145938',
        delivered_qty: '142090',
      },
      { product: 'V-COOL COFFEE', ordered_qty: '1735', delivered_qty: '1635' },
    ]);

    const res = await service.getStockBalance('51210011');

    expect(res).toMatchObject({
      totalPurchasedCartons: 147673,
      totalLoadedCartons: 143725,
      totalRemainingCartons: 3948,
    });
  });

  it('makes the breakdown add up to the totals', async () => {
    // The old implementations disagreed precisely because the per-product rows
    // and the totals came from different passes.
    const { service } = build([
      { product: 'A', ordered_qty: '100', delivered_qty: '60' },
      { product: 'B', ordered_qty: '50', delivered_qty: '50' },
      { product: 'C', ordered_qty: '30', delivered_qty: '0' },
    ]);

    const res = await service.getStockBalance('X');

    const summed = res!.products.reduce((a, p) => a + p.quantityRemaining, 0);
    expect(summed).toBe(res!.totalRemainingCartons);
    expect(res!.totalRemainingCartons).toBe(70);
    expect(res!.totalPurchasedCartons - res!.totalLoadedCartons).toBe(
      res!.totalRemainingCartons,
    );
  });

  it('orders products by what is still owed', async () => {
    const { service } = build([
      { product: 'small', ordered_qty: '10', delivered_qty: '9' },
      { product: 'big', ordered_qty: '100', delivered_qty: '0' },
    ]);

    const res = await service.getStockBalance('X');
    expect(res!.products.map((p) => p.productName)).toEqual(['big', 'small']);
  });

  it('floors an over-delivered product at zero rather than showing negative', async () => {
    // 8 lines in the live feed carry delivered > ordered.
    const { service } = build([
      { product: 'over', ordered_qty: '10', delivered_qty: '12' },
      { product: 'normal', ordered_qty: '100', delivered_qty: '40' },
    ]);

    const res = await service.getStockBalance('X');
    expect(
      res!.products.find((p) => p.productName === 'over')!.quantityRemaining,
    ).toBe(0);
    // The TOTAL still nets the over-delivery off, so it equals purchased-loaded.
    expect(res!.totalRemainingCartons).toBe(58);
  });

  it('reports real zeros for a customer who has collected everything', async () => {
    const { service } = build([
      { product: 'A', ordered_qty: '500', delivered_qty: '500' },
    ]);

    const res = await service.getStockBalance('10110256');
    expect(res).toMatchObject({
      totalPurchasedCartons: 500,
      totalLoadedCartons: 500,
      totalRemainingCartons: 0,
    });
  });

  describe('falls back rather than claiming a distributor has no stock', () => {
    it('returns null when the ERP feed is absent', async () => {
      const { service } = build([], false);
      await expect(service.getStockBalance('10110017')).resolves.toBeNull();
    });

    it('returns null when the ERP knows no orders for this customer', async () => {
      // "Unknown", not "nothing" - the caller keeps the projected figure.
      const { service } = build([]);
      await expect(service.getStockBalance('10110017')).resolves.toBeNull();
    });

    it('returns null on a query error instead of failing the home screen', async () => {
      const { service } = build(new Error('boom'));
      await expect(service.getStockBalance('10110017')).resolves.toBeNull();
    });

    it('does not query for a customer with no erpId', async () => {
      const { service, prisma } = build([]);
      await expect(service.getStockBalance('')).resolves.toBeNull();
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('labels a line the ERP left unnamed', async () => {
      const { service } = build([
        { product: null, ordered_qty: '5', delivered_qty: '1' },
      ]);
      const res = await service.getStockBalance('X');
      expect(res!.products[0].productName).toBe('Unspecified');
    });
  });
});

describe('the stock-balance SQL', () => {
  const sql = ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL;

  it('never sums QTY_TOTAL, which is a DOCUMENT figure', () => {
    // QTY_TOTAL is the order total repeated verbatim on every line. Summing
    // it across lines inflates the balance roughly fourfold - 55,431,486
    // against the true 14,141,327 for open orders.
    expect(sql).not.toContain('QTY_TOTAL');
  });

  it('counts APPROVED orders only', () => {
    // 'V' and 'N' orders have never been delivered against, so counting them
    // adds pure "remaining" for goods the ERP has not agreed to ship.
    expect(sql).toContain("so.payload->>'ApproveStatus' = 'Y'");
  });

  it('applies the approval filter to the PORTFOLIO query too', () => {
    expect(ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL).toContain(
      "so.payload->>'ApproveStatus' = 'Y'",
    );
  });

  it('counts OPEN orders only', () => {
    // CLOSE is the order's state repeated on every line: '0' open, '2'
    // closed. A settled order is not stock the distributor is waiting to
    // collect, and counting it inflates the purchased total and the loading
    // progress with it.
    expect(sql).toContain("so.payload->>'CLOSE' = '0'");
  });

  it('applies the filter to the PORTFOLIO query too', () => {
    // /officers/stock must not disagree with the distributor's own screen.
    expect(ERP_STOCK_BALANCE_FOR_CUSTOMERS_SQL).toContain(
      "so.payload->>'CLOSE' = '0'",
    );
  });

  it('bridges erpId to the ERP internal customer uuid via raw_customer', () => {
    // raw_sales_order.CUSTOMER_ID is the ERP's internal uuid, NOT CUSTOMER_CODE:
    // zero sales-order rows match an erpId directly, so the bridge is required.
    expect(sql).toContain("c.payload->>'CUSTOMER_CODE' = $1");
    expect(sql).toContain("c.payload->>'CUSTOMER_ID'");
    expect(sql).toContain("so.payload->>'CUSTOMER_ID' =");
  });

  it('computes ordered and delivered, the two sides of the formula', () => {
    expect(sql).toContain("'BUSINESS_QTY1'");
    expect(sql).toContain("'DELIVERED_BUSINESS_QTY'");
  });

  it('treats a missing quantity as zero', () => {
    expect(sql).toContain(
      "coalesce(nullif(so.payload->>'BUSINESS_QTY1', '')::numeric, 0)",
    );
  });

  it('restricts to sales-order rows', () => {
    expect(sql).toContain("so.object_type = 'SALES_ORDER'");
  });

  it('takes the freshest customer record when resolving the uuid', () => {
    expect(sql).toContain('ORDER BY c.last_seen_at DESC NULLS LAST');
  });

  it('groups per product so totals and breakdown come from one pass', () => {
    expect(sql).toContain("so.payload->>'ITEM_DESCRIPTION' AS product");
    expect(sql).toContain('GROUP BY 1');
  });
});
