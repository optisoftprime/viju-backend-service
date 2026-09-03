import { WaybillService } from './waybill.service';

/**
 * GET /customers/me/waybills/:id — the preview of a request as submitted.
 *
 * The lines are stored flat, each naming the order it came from. The detail
 * view regroups them so a screen can show the load order by order without
 * doing the join itself.
 */
describe('Loading request detail', () => {
  const PURCHASES = [
    {
      id: 'p-1',
      erpId: '2300-202606110059',
      orderDate: new Date('2026-06-11T00:00:00.000Z'),
      status: 'CLOSED',
      totalItems: 2860,
      totalValue: 4084000,
    },
    {
      id: 'p-2',
      erpId: '2300-202606110027',
      orderDate: new Date('2026-06-11T00:00:00.000Z'),
      status: 'CLOSED',
      totalItems: 51,
      totalValue: 730000,
    },
  ];

  const line = (over: Record<string, unknown> = {}) => ({
    id: 'i-1',
    purchaseId: 'p-1',
    orderReference: '2300-202606110059',
    productId: '101020104',
    productName: 'Mr V Premium Table Water(Lagos)',
    quantity: 120,
    weightPerCarton: 9.38,
    ...over,
  });

  const build = (request: Record<string, unknown> | null) => {
    const prisma = {
      loadingRequest: { findFirst: jest.fn().mockResolvedValue(request) },
      purchase: { findMany: jest.fn().mockResolvedValue(PURCHASES) },
      // The account officers the detail now reports, as the list does.
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          assignedOfficerId: 'o-1',
          assignedOfficer: {
            id: 'o-1',
            name: 'Funmi Adelaja',
            email: 'funmi@viju.local',
            phone: '+2349010000013',
          },
          officerAssignments: [],
        }),
      },
    };
    return {
      prisma,
      service: new WaybillService(
        prisma as never,
        {} as never,
        { listForCustomer: async () => [] } as never,
      ),
    };
  };

  const REQUEST = {
    id: 'lr-1',
    reference: '2300-202606110059',
    customerId: 'c-1',
    linkedPurchaseId: 'p-1',
    quantityCartons: 210,
    loadingCapacity: 1200,
    warehouseName: 'LAGOS WAREHOUSE',
    status: 'PENDING_ASSIGNMENT',
    assignedOfficerId: null,
    linkedPurchase: { id: 'p-1', erpId: '2300-202606110059' },
    items: [
      line(),
      line({
        id: 'i-2',
        productId: '101060111',
        productName: 'V-COOL COFFEE(Abuja)',
        quantity: 80,
        weightPerCarton: 6.33,
      }),
      line({
        id: 'i-3',
        purchaseId: 'p-2',
        orderReference: '2300-202606110027',
        productId: '101011701',
        productName: 'VSMARTIC WHEAT FLAVOURED MILK',
        quantity: 10,
        weightPerCarton: 11.6,
      }),
    ],
  };

  it('groups the lines by the order they came from', async () => {
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.orders).toHaveLength(2);
    expect(res.orders[0]).toMatchObject({
      purchaseId: 'p-1',
      erpId: '2300-202606110059',
      isPrimary: true,
      productLines: 2,
      totalCartons: 200,
    });
    expect(res.orders[1]).toMatchObject({
      purchaseId: 'p-2',
      erpId: '2300-202606110027',
      isPrimary: false,
      productLines: 1,
      totalCartons: 10,
    });
    expect(res.orders[0].products.map((p: any) => p.id)).toEqual([
      'i-1',
      'i-2',
    ]);
    expect(res.orders[1].products.map((p: any) => p.id)).toEqual(['i-3']);
  });

  it('puts the primary order first', async () => {
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.orders[0].isPrimary).toBe(true);
    expect(res.orders.filter((o: any) => o.isPrimary)).toHaveLength(1);
  });

  it('carries the order’s own particulars, not the load’s', async () => {
    // orderTotalItems is the whole ORDER (2,860 cartons); the load takes 200.
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.orders[0].orderTotalItems).toBe(2860);
    expect(res.orders[0].totalCartons).toBe(200);
  });

  it('totals the load across every order', async () => {
    // 120*9.38 + 80*6.33 + 10*11.6 = 1125.6 + 506.4 + 116 = 1748
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.totals).toEqual({
      orders: 2,
      productLines: 3,
      totalCartons: 210,
      totalWeightKg: 1748,
      weightIsComplete: true,
    });
    // The derived total must agree with the stored column.
    expect(res.totals.totalCartons).toBe(res.quantityCartons);
  });

  it('flags an incomplete weight rather than under-reporting it', async () => {
    // The specification sheet does not cover every product, so a null weight
    // is a real case - summing around it silently would look like a total.
    const { service } = build({
      ...REQUEST,
      items: [line(), line({ id: 'i-2', weightPerCarton: null, quantity: 80 })],
    });

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.totals.weightIsComplete).toBe(false);
    expect(res.totals.totalCartons).toBe(200);
    expect(res.totals.totalWeightKg).toBe(1125.6);
  });

  it('keeps `products` flat alongside the grouping', async () => {
    // Callers written before multi-order support read this array.
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.products).toHaveLength(3);
    expect(res).not.toHaveProperty('items');
  });

  it('reads a legacy line with no purchaseId under the linked order', async () => {
    const { service } = build({
      ...REQUEST,
      items: [line({ purchaseId: null, orderReference: null })],
    });

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0]).toMatchObject({
      purchaseId: 'p-1',
      totalCartons: 120,
    });
  });

  it('falls back to the line’s DOC_NO when the order row is gone', async () => {
    // purchaseId is ON DELETE SET NULL, but orderReference is denormalised so
    // the load can still say where it came from.
    const { prisma, service } = build(REQUEST);
    prisma.purchase.findMany.mockResolvedValue([]);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.orders[0].erpId).toBe('2300-202606110059');
    expect(res.orders[0].orderDate).toBeNull();
  });

  describe('a request raised before the product breakdown existed', () => {
    // These declare a bare quantityCartons and have no lines at all. Deriving
    // 0 from the lines would render a load of 76 cartons as empty.
    const LEGACY = { ...REQUEST, quantityCartons: 76, items: [] };

    it('stands the declared cartons in for the missing lines', async () => {
      const { service } = build(LEGACY);

      const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

      expect(res.totals).toEqual({
        orders: 1,
        productLines: 0,
        totalCartons: 76,
        totalWeightKg: 0,
        weightIsComplete: false,
      });
      expect(res.totals.totalCartons).toBe(res.quantityCartons);
    });

    it('attributes them to the one linked order', async () => {
      const { service } = build(LEGACY);

      const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

      expect(res.orders).toHaveLength(1);
      expect(res.orders[0]).toMatchObject({
        purchaseId: 'p-1',
        isPrimary: true,
        totalCartons: 76,
        products: [],
      });
    });

    it('does not claim the weight is known', async () => {
      // 0 kg with weightIsComplete true would read as a weightless load.
      const { service } = build(LEGACY);

      const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

      expect(res.orders[0].weightIsComplete).toBe(false);
    });
  });

  it('reports the account officers, as the list does', async () => {
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.accountOfficers).toEqual([
      {
        id: 'o-1',
        name: 'Funmi Adelaja',
        email: 'funmi@viju.local',
        phone: '+2349010000013',
        isPrimary: true,
      },
    ]);
  });

  it('carries the same product row shape as the list', async () => {
    // One row per PRODUCT, with `spec`, and no per-line order fields.
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(Object.keys(res.products[0]).sort()).toEqual([
      'id',
      'productId',
      'productName',
      'quantity',
      'spec',
      'weightPerCarton',
    ]);
  });

  it('drops the linked-order fields, as the list does', async () => {
    // `orders` conveys the same thing, and better.
    const { service } = build(REQUEST);

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res).not.toHaveProperty('linkedPurchaseId');
    expect(res).not.toHaveProperty('linkedPurchase');
    expect(res).not.toHaveProperty('linkedPurchaseIds');
  });

  it('merges a product entered twice on one order', async () => {
    const { service } = build({
      ...REQUEST,
      items: [line(), line({ id: 'i-2', quantity: 30 })],
    });

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.products).toHaveLength(1);
    expect(res.products[0].quantity).toBe(150);
    expect(res.orders[0].products).toHaveLength(1);
  });

  it('never names the loading officer', async () => {
    const { service } = build({ ...REQUEST, assignedOfficerId: 'o-1' });

    const res = (await service.getForCustomer('c-1', 'lr-1')) as any;

    expect(res.assignedOfficer).toEqual({
      displayName: 'Viju Loading Officer',
    });
  });

  it('404s on another distributor’s request', async () => {
    const { service, prisma } = build(null);

    await expect(service.getForCustomer('c-1', 'lr-9')).rejects.toThrow(
      /Waybill not found/,
    );
    // Scoped in the query, not filtered afterwards.
    expect(prisma.loadingRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 'lr-9',
      customerId: 'c-1',
    });
  });
});
