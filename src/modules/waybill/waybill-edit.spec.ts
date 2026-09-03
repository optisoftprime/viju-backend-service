import { ConflictException, NotFoundException } from '@nestjs/common';
import { WaybillService } from './waybill.service';

/**
 * PATCH /customers/me/waybills/{id} - editing a request nobody has acted on.
 *
 * Once a regional admin has assigned it or an officer has begun loading,
 * people are working to what it says: moving the quantities underneath them
 * would put the truck and the paperwork out of step.
 */
describe('Editing a loading request', () => {
  const STORED_LINES = [
    {
      id: 'i-1',
      purchaseId: 'p-1',
      orderReference: '2310-202606110033',
      productId: '101020104',
      productName: 'Mr V Premium Table Water(Lagos)',
      spec: '100ML',
      quantityLeft: 100,
      quantity: 20,
      weightPerCarton: 2.7,
    },
  ];

  const build = (over: Record<string, unknown> = {}) => {
    const existing = {
      id: 'lr-1',
      customerId: 'c-1',
      reference: '2310-202606110033',
      linkedPurchaseId: 'p-1',
      status: 'PENDING_ASSIGNMENT',
      loadingCapacity: 54,
      items: STORED_LINES,
      ...over,
    };
    const prisma = {
      loadingRequest: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...existing, ...data, items: STORED_LINES }),
          ),
      },
      purchase: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p-2', erpId: '2310-202606110044' }),
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

  it('changes only what was sent', async () => {
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      driverName: 'Musa Danjuma',
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data.driverName).toBe('Musa Danjuma');
    expect(data.truckPlateNumber).toBeUndefined();
    // The lines were not sent, so they are left alone entirely.
    expect(data.items).toBeUndefined();
  });

  it('replaces the product lines wholesale when they are sent', async () => {
    // A partial line list has no meaning a form can express.
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      loadingCapacity: 100,
      products: [{ productName: 'A', weightPerCarton: 5, quantityToLoad: 20 }],
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data.items.deleteMany).toEqual({});
    expect(data.items.create).toHaveLength(1);
    expect(data.quantityCartons).toBe(20);
  });

  it('keeps the replaced lines attributed to the order it is filed under', async () => {
    // A legacy request was raised against an order. An edit replaces its
    // LINES; it must not quietly lose which order they came from, because the
    // body no longer carries anything that could restate it.
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      loadingCapacity: 100,
      products: [{ productName: 'A', weightPerCarton: 5, quantityToLoad: 20 }],
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data.items.create[0]).toEqual(
      expect.objectContaining({
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
      }),
    );
  });

  it('leaves a request filed against no order alone', async () => {
    // Everything raised since submission stopped naming an order.
    const { service, prisma } = build({ linkedPurchaseId: null });

    await service.updateLoadingRequest('c-1', 'lr-1', {
      loadingCapacity: 100,
      products: [{ productName: 'A', weightPerCarton: 5, quantityToLoad: 20 }],
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data.items.create[0]).toEqual(
      expect.objectContaining({ purchaseId: null, orderReference: null }),
    );
  });

  it('re-checks the capacity against the EDITED lines', async () => {
    // Editing quantities and leaving the old capacity behind is exactly the
    // mistake the rule exists for.
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', {
        products: [
          { productName: 'A', weightPerCarton: 5, quantityToLoad: 40 },
        ],
      }),
    ).rejects.toThrow(/products weigh 200kg but loadingCapacity says 54kg/);
  });

  it('checks the STORED lines when only the capacity is edited', async () => {
    // 20 x 2.7 = 54, so 999 does not match.
    const { service } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', { loadingCapacity: 999 }),
    ).rejects.toThrow(/products weigh 54kg but loadingCapacity says 999kg/);
  });

  it('accepts a capacity that matches the stored lines', async () => {
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', { destination: 'Yaba' });

    expect(prisma.loadingRequest.update).toHaveBeenCalled();
  });

  it('never changes the reference, nor which order it is filed under', async () => {
    // `reference` is what the depot and the ERP know the request by, and the
    // body no longer names an order to re-file it against.
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      driverName: 'Musa Danjuma',
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('reference');
    expect(data).not.toHaveProperty('linkedPurchaseId');
  });

  describe('only while PENDING_ASSIGNMENT', () => {
    for (const status of [
      'ASSIGNED',
      'LOADING_IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ]) {
      it(`refuses a ${status} request with 409`, async () => {
        const { service, prisma } = build({ status });

        await expect(
          service.updateLoadingRequest('c-1', 'lr-1', { driverName: 'X' }),
        ).rejects.toThrow(ConflictException);
        expect(prisma.loadingRequest.update).not.toHaveBeenCalled();
      });
    }
  });

  it('refuses an edit that zeroes every line', async () => {
    // Emptying a live request is what cancelling is for.
    const { service, prisma } = build();

    await expect(
      service.updateLoadingRequest('c-1', 'lr-1', {
        loadingCapacity: 1,
        products: [{ productName: 'A', weightPerCarton: 5, quantityToLoad: 0 }],
      }),
    ).rejects.toThrow(
      /total quantityToLoad across products must be more than 0/,
    );
    expect(prisma.loadingRequest.update).not.toHaveBeenCalled();
  });

  it('allows a zero line while the total stays positive', async () => {
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      loadingCapacity: 100,
      products: [
        { productName: 'A', weightPerCarton: 5, quantityToLoad: 20 },
        { productName: 'B', weightPerCarton: 3, quantityToLoad: 0 },
      ],
    });

    expect(prisma.loadingRequest.update).toHaveBeenCalled();
  });

  it('404s on another distributor’s request', async () => {
    const { service, prisma } = build();
    prisma.loadingRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.updateLoadingRequest('c-1', 'lr-9', { driverName: 'X' }),
    ).rejects.toThrow(NotFoundException);
    // Scoped in the query, not filtered afterwards.
    expect(prisma.loadingRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 'lr-9',
      customerId: 'c-1',
    });
  });

  it('returns the request in the same shape the detail route uses', async () => {
    const { service } = build();

    const res = (await service.updateLoadingRequest('c-1', 'lr-1', {
      destination: 'Yaba',
    })) as any;

    expect(res).toHaveProperty('products');
    expect(res).toHaveProperty('linkedPurchaseIds');
    expect(res).not.toHaveProperty('items');
  });
});
