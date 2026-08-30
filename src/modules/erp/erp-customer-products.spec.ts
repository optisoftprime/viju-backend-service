import { ErpCustomerProductsService } from './erp-customer-products.service';

/**
 * GET /erp/orders/{orderId}/products — the products on one sales order,
 * carried through the Viju product specification sheet.
 *
 * `orderId` is the id `linkedPurchaseId` carries on GET /customers/me/waybills,
 * so a distributor holding a loading request can ask what is on the order it is
 * against.
 */
describe('ERP order products', () => {
  const build = (
    rows: unknown,
    purchase: unknown = { erpId: '2310-202606110033' },
    available = true,
  ) => {
    const prisma = {
      purchase: { findFirst: jest.fn().mockResolvedValue(purchase) },
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('to_regclass')) {
          return Promise.resolve([{ present: available }]);
        }
        if (rows instanceof Error) return Promise.reject(rows);
        return Promise.resolve(rows);
      }),
    };
    return { prisma, service: new ErpCustomerProductsService(prisma as never) };
  };

  it('returns productId, productName and weightPerCarton per product', async () => {
    const { service } = build([
      { descr: '750ml water(L-水)', spec: '750ML(L)' },
    ]);

    await expect(service.listForOrder('purchase-uuid-1')).resolves.toEqual([
      {
        productId: '101020104',
        productName: '750ml water(L-水)',
        weightPerCarton: 9.38,
        matchedOn: 'SPEC_AND_NAME',
      },
    ]);
  });

  it('queries the feed by DOC_NO, resolved from the purchase', async () => {
    const { service, prisma } = build([]);

    await service.listForOrder('purchase-uuid-1');

    const [sql, param] = prisma.$queryRawUnsafe.mock.calls[1];
    expect(sql).toContain("so.payload->>'DOC_NO' = $1");
    expect(param).toBe('2310-202606110033');
  });

  it('accepts either a Purchase.id uuid or the DOC_NO', async () => {
    const { service, prisma } = build([]);

    await service.listForOrder('2310-202606110033');

    // Purchase.erpId IS the DOC_NO, so one lookup covers both forms.
    expect(prisma.purchase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: '2310-202606110033' }, { erpId: '2310-202606110033' }],
        }),
      }),
    );
  });

  it('collapses a product the feed lists under two specifications', async () => {
    // '(1.5)MALT MILK(O)' arrives under both 500ML果汁(O) and 500ML麦汁(O),
    // which resolve to the same code and weight — indistinguishable on screen.
    const { service } = build([
      { descr: '(1.5)MALT MILK(O)', spec: '500ML果汁(O)' },
      { descr: '(1.5)MALT MILK(O)', spec: '500ML麦汁(O)' },
    ]);

    const list = await service.listForOrder('purchase-uuid-1');
    expect(list).toHaveLength(1);
    expect(list[0].productId).toBe('101010513');
  });

  it('keeps two genuinely different products apart', async () => {
    const { service } = build([
      { descr: 'Viju Wheat Milk', spec: '320ML中性奶(O)' },
      { descr: 'Viju Wheat Milk', spec: '500ML中性奶(O)' },
    ]);

    const list = await service.listForOrder('purchase-uuid-1');
    // Same name, different size — different carton weight, so both belong.
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.weightPerCarton).sort()).toEqual([4.22, 6.6]);
  });

  it('returns nulls, not a guessed weight, for a product off the sheet', async () => {
    const { service } = build([{ descr: '18.9L water(L)', spec: '18.9(L)' }]);

    await expect(service.listForOrder('purchase-uuid-1')).resolves.toEqual([
      {
        productId: null,
        productName: '18.9L water(L)',
        weightPerCarton: null,
        matchedOn: 'NONE',
      },
    ]);
  });

  describe('a distributor is pinned to their own orders', () => {
    it('scopes the purchase lookup by customer', async () => {
      const { service, prisma } = build([]);

      await service.listForOrder('purchase-uuid-1', 'customer-1');

      expect(prisma.purchase.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'customer-1' }),
        }),
      );
    });

    it("returns [] for another distributor's order", async () => {
      // Scoped lookup finds nothing, so there is nothing to read.
      const { service, prisma } = build([], null);

      await expect(
        service.listForOrder('someone-elses-order', 'customer-1'),
      ).resolves.toEqual([]);
      // Never reaches the feed.
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1); // probe only
    });

    it('lets STAFF read an order the projector never copied locally', async () => {
      // No local Purchase row, but the DOC_NO is still a real ERP order.
      // Staff pass no customer scope, so the id is used directly.
      const { service, prisma } = build(
        [{ descr: '750ml water(L-水)', spec: '750ML(L)' }],
        null,
      );

      const list = await service.listForOrder('2310-202606110033');

      expect(list).toHaveLength(1);
      expect(prisma.$queryRawUnsafe.mock.calls[1][1]).toBe('2310-202606110033');
    });
  });

  describe('degrades to an empty list rather than erroring', () => {
    it('when the ERP feed is absent', async () => {
      const { service } = build([], { erpId: 'D1' }, false);
      await expect(service.listForOrder('purchase-uuid-1')).resolves.toEqual(
        [],
      );
    });

    it('when the query fails', async () => {
      const { service } = build(new Error('boom'));
      await expect(service.listForOrder('purchase-uuid-1')).resolves.toEqual(
        [],
      );
    });

    it('without querying at all for an empty id', async () => {
      const { service, prisma } = build([]);
      await expect(service.listForOrder('')).resolves.toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('drops a line the ERP left with no description', async () => {
      const { service } = build([
        { descr: '   ', spec: '750ML(L)' },
        { descr: '750ml water(L-水)', spec: '750ML(L)' },
      ]);
      await expect(
        service.listForOrder('purchase-uuid-1'),
      ).resolves.toHaveLength(1);
    });
  });
});
