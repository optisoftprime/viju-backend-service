import { Prisma } from '@prisma/client';
import { WaybillService } from './waybill.service';

/**
 * `reference` identifies the loading request to the depot and the ERP.
 *
 * It used to be `WB-<timestamp>`, which matched nothing anyone recognises.
 * A request is now filed against the ACCOUNT rather than a document - the
 * body no longer names an order - so the reference is built from the
 * distributor's own ERP code and the date: `LR-<erpCode>-<yyyymmdd>`. Still
 * recognisable by eye, and still unique once the `-02` suffix settles
 * same-day collisions.
 */
describe('Loading request reference', () => {
  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  /** The base the service builds for this distributor, today. */
  const base = () =>
    `LR-10110003-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  const build = (createImpl?: jest.Mock) => {
    const create =
      createImpl ??
      jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'lr-1', reference: data.reference, items: [] }),
        );
    const prisma = {
      termsAcceptance: {
        findFirst: jest.fn().mockResolvedValue({ acceptedAt: new Date() }),
      },
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c-1',
          erpId: '10110003',
          region: 'LAGOS',
          name: 'ADLAK',
        }),
      },
      purchase: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p-1', erpId: '2310-202606110033' }),
      },
      staff: { findMany: jest.fn().mockResolvedValue([]) },
      loadingRequest: { create },
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      create,
      service: new WaybillService(
        prisma as never,
        notifications as never,
        {
          listForCustomer: async () => [],
        } as never,
      ),
    };
  };

  const dto = {
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    // A request must load something. These tests are about the reference, so
    // the line is the smallest one that satisfies that.
    products: [{ productName: 'A', quantityToLoad: 1 }],
    requestedLoadingDate: '2026-08-30',
  };

  it('is built from the distributor and the date, not a timestamp', async () => {
    const { service, create } = build();

    const res = await service.submitLoadingRequest('c-1', dto as never);

    expect(create.mock.calls[0][0].data.reference).toBe(base());
    expect(res.reference).toBe(base());
    // The old shape must not come back.
    expect(res.reference).not.toMatch(/^WB-\d+$/);
  });

  it('files against the account, naming no order', async () => {
    // The body no longer carries linkedPurchaseId, so nothing is filed under
    // an order and no order is looked up on the way in.
    const { service, create, prisma } = build();

    await service.submitLoadingRequest('c-1', dto as never);

    expect(create.mock.calls[0][0].data.linkedPurchaseId).toBeNull();
    expect(prisma.purchase.findFirst).not.toHaveBeenCalled();
  });

  describe('a distributor loading twice in one day', () => {
    it('suffixes the second load rather than failing on the unique index', async () => {
      // reference is @unique and a distributor may raise two requests on one
      // day, so this is a real case, not a hypothetical.
      const create = jest
        .fn()
        .mockRejectedValueOnce(duplicate())
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'lr-2', reference: data.reference, items: [] }),
        );
      const { service } = build(create);

      const res = await service.submitLoadingRequest('c-1', dto as never);

      expect(create.mock.calls[0][0].data.reference).toBe(base());
      expect(create.mock.calls[1][0].data.reference).toBe(`${base()}-02`);
      expect(res.reference).toBe(`${base()}-02`);
    });

    it('keeps counting for a third and fourth load', async () => {
      const create = jest
        .fn()
        .mockRejectedValueOnce(duplicate())
        .mockRejectedValueOnce(duplicate())
        .mockRejectedValueOnce(duplicate())
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'lr-4', reference: data.reference, items: [] }),
        );
      const { service } = build(create);

      const res = await service.submitLoadingRequest('c-1', dto as never);
      expect(res.reference).toBe(`${base()}-04`);
    });

    it('retries rather than counting first, so a race cannot collide', async () => {
      // Counting existing rows would let two concurrent submissions compute
      // the same suffix; the loser would fail outright.
      const { service, prisma } = build();
      await service.submitLoadingRequest('c-1', dto as never);
      expect(prisma.loadingRequest.count).toBeUndefined();
    });
  });

  it('does not swallow a failure that is not a duplicate reference', async () => {
    const create = jest.fn().mockRejectedValue(new Error('database on fire'));
    const { service } = build(create);

    await expect(
      service.submitLoadingRequest('c-1', dto as never),
    ).rejects.toThrow('database on fire');
    // One attempt only — a real fault must surface, not be retried 25 times.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of attempts', async () => {
    const create = jest.fn().mockRejectedValue(duplicate());
    const { service } = build(create);

    await expect(
      service.submitLoadingRequest('c-1', dto as never),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(25);
  });
});
