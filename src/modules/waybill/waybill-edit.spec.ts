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
      service: new WaybillService(prisma as never, {} as never),
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

  it('never changes the reference', async () => {
    // It is what the depot and the ERP know the request by.
    const { service, prisma } = build();

    await service.updateLoadingRequest('c-1', 'lr-1', {
      linkedPurchaseId: 'p-2',
    });

    const data = prisma.loadingRequest.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('reference');
    expect(data.linkedPurchaseId).toBe('p-2');
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
