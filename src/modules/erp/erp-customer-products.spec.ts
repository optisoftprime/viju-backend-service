import { ErpCustomerProductsService } from './erp-customer-products.service';

/**
 * GET /erp/orders/{customerId}/products - what one distributor still has to
 * collect, product by product.
 *
 * This is the picker behind a loading request. A request is filed against the
 * ACCOUNT rather than one order, so the products it may draw on are the
 * distributor's whole outstanding stock.
 *
 * `quantityLeft` comes from the stock-balance query rather than a second one
 * of its own, so the picker and GET /customers/me/stock-balance cannot
 * disagree about how much of a product is outstanding.
 */
describe('ERP customer products', () => {
  const ADLAK = { id: 'c-1', erpId: '10110003' };

  const build = (
    balance: unknown = {
      totalPurchasedCartons: 0,
      totalLoadedCartons: 0,
      totalRemainingCartons: 0,
      products: [
        {
          itemCode: '101020104',
          productName: '750ml water(L-水)',
          spec: '750ML(L)',
          quantityPaid: 120,
          quantityLoaded: 100,
          quantityRemaining: 20,
          lastOrderDate: '2026-06-11',
        },
      ],
    },
    customer: unknown = ADLAK,
  ) => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue(customer) },
    };
    const stockBalance = {
      getStockBalance: jest.fn().mockResolvedValue(balance),
    };
    const itemCodes = { codeFor: () => null };
    return {
      prisma,
      stockBalance,
      service: new ErpCustomerProductsService(
        prisma as never,
        itemCodes as never,
        stockBalance as never,
      ),
    };
  };

  it('returns the five fields the picker renders', async () => {
    const { service } = build();

    await expect(service.listForCustomer('c-1')).resolves.toEqual([
      {
        productId: '101020104',
        productName: '750ml water(L-水)',
        spec: '750ML(L)',
        weightPerCarton: 9.38,
        quantityLeft: 20,
      },
    ]);
  });

  it('reads quantityLeft from the stock balance, not a query of its own', async () => {
    // One formula, so the picker and the stock screen cannot drift.
    const { service, stockBalance } = build();

    await service.listForCustomer('c-1');

    expect(stockBalance.getStockBalance).toHaveBeenCalledWith('10110003');
  });

  it('accepts either the Customer.id uuid or the ERP code', async () => {
    const { service, prisma } = build();

    await service.listForCustomer('10110003');

    expect(prisma.customer.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ id: '10110003' }, { erpId: '10110003' }],
    });
  });

  it('lists only what is still to collect', async () => {
    // A product taken in full is not something a truck can be loaded with.
    const { service } = build({
      products: [
        {
          itemCode: '101020104',
          productName: '750ml water(L-水)',
          spec: '750ML(L)',
          quantityRemaining: 20,
        },
        {
          itemCode: '101060111',
          productName: 'V-COOL COFFEE(Abuja)',
          spec: '500ML',
          quantityRemaining: 0,
        },
      ],
    });

    const res = await service.listForCustomer('c-1');

    expect(res).toHaveLength(1);
    expect(res[0].productId).toBe('101020104');
  });

  it('falls back to the specification sheet for a code the feed omits', async () => {
    const { service } = build({
      products: [
        {
          itemCode: null,
          productName: '750ml water(L-水)',
          spec: '750ML(L)',
          quantityRemaining: 5,
        },
      ],
    });

    const res = await service.listForCustomer('c-1');

    expect(res[0].productId).toBe('101020104');
  });

  it('returns nulls, not a guessed weight, for a product off the sheet', async () => {
    const { service } = build({
      products: [
        {
          itemCode: null,
          productName: 'PE包装膜Nylon',
          spec: null,
          quantityRemaining: 5,
        },
      ],
    });

    await expect(service.listForCustomer('c-1')).resolves.toEqual([
      {
        productId: null,
        productName: 'PE包装膜Nylon',
        spec: null,
        weightPerCarton: null,
        quantityLeft: 5,
      },
    ]);
  });

  describe('a distributor is pinned to their own stock', () => {
    it('returns their stock when the id is their own', async () => {
      const { service } = build();

      await expect(service.listForCustomer('c-1', 'c-1')).resolves.toHaveLength(
        1,
      );
    });

    it('accepts their own erpId as naming themselves', async () => {
      const { service } = build();

      await expect(
        service.listForCustomer('10110003', 'c-1'),
      ).resolves.toHaveLength(1);
    });

    it("returns [] for another distributor's id", async () => {
      // The id in the path never widens what a token can see.
      const { service, stockBalance } = build();

      await expect(service.listForCustomer('c-1', 'c-9')).resolves.toEqual([]);
      expect(stockBalance.getStockBalance).not.toHaveBeenCalled();
    });

    it('lets STAFF read any distributor', async () => {
      // No requesterId is passed for staff.
      const { service } = build();

      await expect(service.listForCustomer('c-1')).resolves.toHaveLength(1);
    });
  });

  describe('degrades to an empty list rather than erroring', () => {
    it('for an unknown distributor', async () => {
      const { service, stockBalance } = build(undefined, null);

      await expect(service.listForCustomer('c-9')).resolves.toEqual([]);
      expect(stockBalance.getStockBalance).not.toHaveBeenCalled();
    });

    it('when the ERP feed says nothing about them', async () => {
      // Null means "we cannot say", and a picker renders empty.
      const { service } = build(null);

      await expect(service.listForCustomer('c-1')).resolves.toEqual([]);
    });

    it('without querying at all for an empty id', async () => {
      const { service, prisma } = build();

      await expect(service.listForCustomer('')).resolves.toEqual([]);
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });
  });
});
