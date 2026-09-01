import { WaybillService } from './waybill.service';

/**
 * One loading request spanning SEVERAL orders.
 *
 * A truck is loaded against more than one sales order at a time, so the submit
 * body carries an `orders` map: each key is an order the distributor is drawing
 * from, each value the product lines taken from it. The older single-order
 * `products` array still works and is attributed to `linkedPurchaseId`.
 */
describe('Loading request across several orders', () => {
  const ORDERS: Record<string, { id: string; erpId: string }> = {
    'p-1': { id: 'p-1', erpId: '2310-202606110033' },
    'p-2': { id: 'p-2', erpId: '2310-202606110044' },
  };

  const build = () => {
    const prisma = {
      termsAcceptance: {
        findFirst: jest.fn().mockResolvedValue({ acceptedAt: new Date() }),
      },
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c-1', region: 'LAGOS', name: 'ADLAK' }),
      },
      purchase: {
        // Stands in for the real lookup: an order resolves by uuid OR DOC_NO,
        // and only when it belongs to the calling customer.
        findFirst: jest.fn(({ where }) => {
          if (where.customerId !== 'c-1') return Promise.resolve(null);
          const keys: string[] = where.OR
            ? where.OR.map((c: Record<string, string>) => c.id ?? c.erpId)
            : [where.id];
          const found = Object.values(ORDERS).find((o) =>
            keys.some((k) => k === o.id || k === o.erpId),
          );
          return Promise.resolve(found ?? null);
        }),
      },
      staff: { findMany: jest.fn().mockResolvedValue([]) },
      loadingRequest: {
        create: jest.fn().mockResolvedValue({ id: 'lr-1', items: [] }),
      },
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      service: new WaybillService(prisma as never, notifications as never),
    };
  };

  const baseDto = {
    warehouseName: 'LAGOS WAREHOUSE',
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    // Kilograms, and ample: these tests are about which order a line came
    // from, not about the capacity guard, which has its own spec.
    loadingCapacity: 20000,
    linkedPurchaseId: 'p-1',
    requestedLoadingDate: '2026-08-30',
  };

  const submit = async (dto: Record<string, unknown>) => {
    const { service, prisma } = build();
    await service.submitLoadingRequest('c-1', { ...baseDto, ...dto } as never);
    return prisma.loadingRequest.create.mock.calls[0][0].data;
  };

  it('records which order each line came from', async () => {
    const data = await submit({
      orders: {
        'p-1': [
          {
            productId: '101020104',
            productName: 'Product A',
            quantity: 120,
            weightPerCarton: 25,
          },
        ],
        'p-2': [
          {
            productId: '101020105',
            productName: 'Product B',
            quantity: 10,
            weightPerCarton: 20,
          },
        ],
      },
    });

    expect(data.items.create).toEqual([
      {
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        productId: '101020104',
        productName: 'Product A',
        quantity: 120,
        weightPerCarton: 25,
      },
      {
        purchaseId: 'p-2',
        orderReference: '2310-202606110044',
        productId: '101020105',
        productName: 'Product B',
        quantity: 10,
        weightPerCarton: 20,
      },
    ]);
  });

  it('keys the map by DOC_NO just as well as by uuid', async () => {
    // The distributor app holds the DOC_NO on screen; either identifies the
    // order.
    const data = await submit({
      orders: {
        '2310-202606110044': [{ productName: 'Product B', quantity: 10 }],
      },
    });

    expect(data.items.create[0]).toMatchObject({
      purchaseId: 'p-2',
      orderReference: '2310-202606110044',
    });
  });

  it('sums quantityCartons ACROSS the orders', async () => {
    // 120 + 80 + 10 + 90. The stock calculations read this column, so it has to
    // count the whole load and not just the linked order's share of it.
    const data = await submit({
      orders: {
        'p-1': [
          { productName: 'Product A', quantity: 120 },
          { productName: 'Product B', quantity: 80 },
        ],
        'p-2': [
          { productName: 'Product A', quantity: 10 },
          { productName: 'Product B', quantity: 90 },
        ],
      },
      quantityCartons: 9999,
    });

    expect(data.quantityCartons).toBe(300);
  });

  it('refuses an order belonging to another distributor', async () => {
    const { service } = build();

    await expect(
      service.submitLoadingRequest('c-1', {
        ...baseDto,
        orders: { 'p-9': [{ productName: 'Product A', quantity: 5 }] },
      } as never),
    ).rejects.toThrow(/does not belong to this customer/);
  });

  it('still takes the single-order `products` body', async () => {
    const data = await submit({
      products: [
        { productName: 'Product A', quantity: 120, weightPerCarton: 25 },
      ],
    });

    expect(data.items.create).toEqual([
      {
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        productId: null,
        productName: 'Product A',
        quantity: 120,
        weightPerCarton: 25,
      },
    ]);
  });

  it('prefers `orders` when a body carries both', async () => {
    const data = await submit({
      products: [{ productName: 'Ignored', quantity: 500 }],
      orders: { 'p-2': [{ productName: 'Product B', quantity: 10 }] },
    });

    expect(data.items.create).toHaveLength(1);
    expect(data.items.create[0].productName).toBe('Product B');
    expect(data.quantityCartons).toBe(10);
  });

  it('coerces a numeric productId, as the single-order form does', async () => {
    // ERP item codes look numeric and JSON keeps them numeric unless quoted.
    const data = await submit({
      orders: {
        'p-1': [{ productId: 101020104, productName: 'A', quantity: 1 }],
      },
    });

    expect(data.items.create[0].productId).toBe('101020104');
  });

  it('rejects a line with no quantity', async () => {
    const { service } = build();

    await expect(
      service.submitLoadingRequest('c-1', {
        ...baseDto,
        orders: { 'p-1': [{ productName: 'Product A' }] },
      } as never),
    ).rejects.toThrow(/productName or quantity/);
  });

  it('rejects a value that is not an array of products', async () => {
    const { service } = build();

    await expect(
      service.submitLoadingRequest('c-1', {
        ...baseDto,
        orders: { 'p-1': { productName: 'Product A', quantity: 1 } },
      } as never),
    ).rejects.toThrow(/must be an array/);
  });

  describe('linkedPurchaseId as a list', () => {
    it('files the request under the FIRST order', async () => {
      const data = await submit({
        linkedPurchaseId: ['p-2', 'p-1'],
        orders: {
          'p-2': [{ productName: 'Product B', quantity: 10 }],
          'p-1': [{ productName: 'Product A', quantity: 120 }],
        },
      });

      // The column takes the primary; the reference is drawn from its DOC_NO.
      expect(data.linkedPurchaseId).toBe('p-2');
    });

    it('echoes every order back as linkedPurchaseIds', async () => {
      const { service, prisma } = build();
      prisma.loadingRequest.create.mockResolvedValue({
        id: 'lr-1',
        linkedPurchaseId: 'p-1',
        items: [{ purchaseId: 'p-1' }, { purchaseId: 'p-2' }],
      });

      const res = await service.submitLoadingRequest('c-1', {
        ...baseDto,
        linkedPurchaseId: ['p-1', 'p-2'],
        orders: {
          'p-1': [{ productName: 'Product A', quantity: 120 }],
          'p-2': [{ productName: 'Product B', quantity: 10 }],
        },
      } as never);

      expect(
        (res as { linkedPurchaseIds: string[] }).linkedPurchaseIds,
      ).toEqual(['p-1', 'p-2']);
    });

    it('takes DOC_NOs in the list as well as uuids', async () => {
      const data = await submit({
        linkedPurchaseId: ['2310-202606110044'],
        orders: {
          '2310-202606110044': [{ productName: 'Product B', quantity: 10 }],
        },
      });

      expect(data.linkedPurchaseId).toBe('p-2');
    });

    it('refuses an order in the list that is not the caller’s', async () => {
      const { service } = build();

      await expect(
        service.submitLoadingRequest('c-1', {
          ...baseDto,
          linkedPurchaseId: ['p-1', 'p-9'],
          orders: { 'p-1': [{ productName: 'Product A', quantity: 1 }] },
        } as never),
      ).rejects.toThrow(/Linked order "p-9" was not found/);
    });

    it('refuses an order listed but absent from `orders`', async () => {
      // The lines are the only record of which orders a load draws on, so an
      // order with no lines would vanish silently.
      const { service } = build();

      await expect(
        service.submitLoadingRequest('c-1', {
          ...baseDto,
          linkedPurchaseId: ['p-1', 'p-2'],
          orders: { 'p-1': [{ productName: 'Product A', quantity: 1 }] },
        } as never),
      ).rejects.toThrow(/listed in linkedPurchaseId but has no products/);
    });

    it('does not impose that rule on the single-order form', async () => {
      // Sending a bare id has never promised the two agree; unchanged.
      const data = await submit({
        linkedPurchaseId: 'p-1',
        orders: { 'p-2': [{ productName: 'Product B', quantity: 10 }] },
      });

      expect(data.linkedPurchaseId).toBe('p-1');
      expect(data.items.create).toHaveLength(1);
    });

    it('treats the same order twice as one', async () => {
      const data = await submit({
        linkedPurchaseId: ['p-1', 'p-1'],
        orders: { 'p-1': [{ productName: 'Product A', quantity: 5 }] },
      });

      expect(data.linkedPurchaseId).toBe('p-1');
    });

    it('rejects an empty list', async () => {
      const { service } = build();

      await expect(
        service.submitLoadingRequest('c-1', {
          ...baseDto,
          linkedPurchaseId: [],
        } as never),
      ).rejects.toThrow(/at least one order/);
    });

    it('keeps the original message for a bad single id', async () => {
      // Clients already match on this string.
      const { service } = build();

      await expect(
        service.submitLoadingRequest('c-1', {
          ...baseDto,
          linkedPurchaseId: 'p-9',
        } as never),
      ).rejects.toThrow(/^Linked order not found/);
    });
  });

  it('leaves an empty map behaving like no products at all', async () => {
    const data = await submit({ orders: {}, quantityCartons: 320 });

    expect(data.items).toBeUndefined();
    expect(data.quantityCartons).toBe(320);
  });
});
