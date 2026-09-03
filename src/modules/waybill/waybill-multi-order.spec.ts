import { WaybillService } from './waybill.service';

/**
 * One loading request spanning SEVERAL orders.
 *
 * A truck is loaded against more than one sales order at a time, so the body
 * may carry an `orders` map: each key is an order the distributor is drawing
 * from, each value the product lines taken from it. `linkedPurchaseId` names
 * the same orders, its first entry being the primary one.
 *
 * THIS IS THE EDIT PATH ONLY. Submission dropped both fields: a request is
 * filed against the ACCOUNT, and the picker behind it
 * (GET /erp/orders/{customerId}/products) reports the distributor's whole
 * outstanding stock across every open order rather than one document's lines,
 * so there was nothing left for the client to state. The resolution logic
 * these tests cover is shared, and PATCH is where it is still reachable.
 */
describe('Loading request across several orders', () => {
  const ORDERS: Record<string, { id: string; erpId: string }> = {
    'p-1': { id: 'p-1', erpId: '2310-202606110033' },
    'p-2': { id: 'p-2', erpId: '2310-202606110044' },
  };

  const build = () => {
    const existing = {
      id: 'lr-1',
      customerId: 'c-1',
      reference: '2310-202606110033',
      linkedPurchaseId: 'p-1',
      status: 'PENDING_ASSIGNMENT',
      // Null so the capacity rule stands aside: it must EQUAL the load's
      // weight, and these tests are about which order a line came from. The
      // rule has its own spec.
      loadingCapacity: null,
      items: [],
    };
    const prisma = {
      loadingRequest: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...existing, ...data, items: [] }),
          ),
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
    };
    return {
      prisma,
      service: new WaybillService(
        prisma as never,
        {} as never,
        {
          listForCustomer: async () => [],
        } as never,
      ),
    };
  };

  /** Applies an edit and hands back what would have been written. */
  const edit = async (dto: Record<string, unknown>) => {
    const { service, prisma } = build();
    await service.updateLoadingRequest('c-1', 'lr-1', dto);
    return prisma.loadingRequest.update.mock.calls[0][0].data;
  };

  it('records which order each line came from', async () => {
    const data = await edit({
      orders: {
        'p-1': [{ productName: '750ml water(L-水)', quantity: 120 }],
        'p-2': [{ productName: '18.9L water(L)', quantity: 80 }],
      },
    });

    expect(data.items.create).toEqual([
      expect.objectContaining({
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        productName: '750ml water(L-水)',
        quantity: 120,
      }),
      expect.objectContaining({
        purchaseId: 'p-2',
        orderReference: '2310-202606110044',
        productName: '18.9L water(L)',
        quantity: 80,
      }),
    ]);
  });

  it('keys the map by DOC_NO just as well as by uuid', async () => {
    const data = await edit({
      orders: {
        '2310-202606110044': [{ productName: '18.9L water(L)', quantity: 80 }],
      },
    });

    expect(data.items.create[0]).toEqual(
      expect.objectContaining({
        purchaseId: 'p-2',
        orderReference: '2310-202606110044',
      }),
    );
  });

  it('sums quantityCartons ACROSS the orders', async () => {
    const data = await edit({
      orders: {
        'p-1': [{ productName: 'A', quantity: 120 }],
        'p-2': [{ productName: 'B', quantity: 80 }],
      },
    });

    expect(data.quantityCartons).toBe(200);
  });

  it('refuses an order belonging to another distributor', async () => {
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', {
        orders: { 'p-9': [{ productName: 'A', quantity: 1 }] },
      }),
    ).rejects.toThrow(/Order "p-9" was not found/);
  });

  it('still takes the flat `products` body', async () => {
    // Attributed to the order the request is already filed under.
    const data = await edit({
      products: [{ productName: 'A', quantityToLoad: 10 }],
    });

    expect(data.items.create).toEqual([
      expect.objectContaining({
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        quantity: 10,
      }),
    ]);
  });

  it('prefers `orders` when a body carries both', async () => {
    const data = await edit({
      products: [{ productName: 'ignored', quantityToLoad: 999 }],
      orders: { 'p-2': [{ productName: 'A', quantity: 5 }] },
    });

    expect(data.items.create).toHaveLength(1);
    expect(data.items.create[0].productName).toBe('A');
  });

  it('coerces a numeric productId, as the flat form does', async () => {
    const data = await edit({
      orders: {
        'p-1': [{ productId: 101020104, productName: 'A', quantity: 5 }],
      },
    });

    expect(data.items.create[0].productId).toBe('101020104');
  });

  it('rejects a line with no quantity', async () => {
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', {
        orders: { 'p-1': [{ productName: 'A' }] },
      }),
    ).rejects.toThrow(/without a productName or quantity/);
  });

  it('rejects a value that is not an array of products', async () => {
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', {
        orders: { 'p-1': { productName: 'A', quantity: 5 } },
      } as never),
    ).rejects.toThrow(/must be an array of products/);
  });

  describe('linkedPurchaseId as a list', () => {
    it('re-files the request under the FIRST order', async () => {
      const data = await edit({
        linkedPurchaseId: ['p-2', 'p-1'],
        orders: {
          'p-2': [{ productName: 'A', quantity: 5 }],
          'p-1': [{ productName: 'B', quantity: 5 }],
        },
      });

      expect(data.linkedPurchaseId).toBe('p-2');
    });

    it('takes DOC_NOs in the list as well as uuids', async () => {
      const data = await edit({
        linkedPurchaseId: ['2310-202606110044'],
        orders: { 'p-2': [{ productName: 'A', quantity: 5 }] },
      });

      expect(data.linkedPurchaseId).toBe('p-2');
    });

    it('refuses an order in the list that is not the caller’s', async () => {
      const { service } = build();

      await expect(
        service.updateLoadingRequest('c-1', 'lr-1', {
          linkedPurchaseId: ['p-1', 'p-9'],
          orders: { 'p-1': [{ productName: 'A', quantity: 5 }] },
        }),
      ).rejects.toThrow(/Linked order "p-9" was not found/);
    });

    it('refuses an order listed but absent from `orders`', async () => {
      // The lines are the only record of which orders a request draws on, so
      // an order named and then not loaded from would be silently dropped.
      const { service } = build();

      await expect(
        service.updateLoadingRequest('c-1', 'lr-1', {
          linkedPurchaseId: ['p-1', 'p-2'],
          orders: { 'p-1': [{ productName: 'A', quantity: 5 }] },
        }),
      ).rejects.toThrow(
        /"2310-202606110044" is listed in linkedPurchaseId but has no products/,
      );
    });

    it('does not impose that rule on the single-id form', async () => {
      const data = await edit({
        linkedPurchaseId: 'p-1',
        orders: { 'p-2': [{ productName: 'A', quantity: 5 }] },
      });

      expect(data.items.create).toHaveLength(1);
    });

    it('treats the same order twice as one', async () => {
      const data = await edit({
        linkedPurchaseId: ['p-1', 'p-1'],
        orders: { 'p-1': [{ productName: 'A', quantity: 5 }] },
      });

      expect(data.linkedPurchaseId).toBe('p-1');
      expect(data.items.create).toHaveLength(1);
    });

    it('keeps the original message for a bad single id', async () => {
      // Clients already match on this wording.
      const { service } = build();

      await expect(
        service.updateLoadingRequest('c-1', 'lr-1', {
          linkedPurchaseId: 'p-9',
          products: [{ productName: 'A', quantityToLoad: 5 }],
        }),
      ).rejects.toThrow(/Linked order not found/);
    });
  });

  it('refuses an empty map - it loads nothing', async () => {
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', { orders: {} }),
    ).rejects.toThrow(/must be more than 0/);
  });
});
