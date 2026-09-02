import { Prisma } from '@prisma/client';
import { WaybillService } from './waybill.service';

/**
 * `reference` is the ERP document number of the order being loaded.
 *
 * It used to be `WB-<timestamp>`, which matched nothing the ERP or the
 * distributor recognises. It is now the same DOC_NO that
 * `linkedPurchase.erpId` carries, so a reference can be checked against the
 * ERP by eye.
 */
describe('Loading request reference', () => {
  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

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
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c-1', region: 'LAGOS', name: 'ADLAK' }),
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
      service: new WaybillService(prisma as never, notifications as never),
    };
  };

  const dto = {
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    linkedPurchaseId: 'p-1',
    // A request must load something. These tests are about the reference, so
    // the line is the smallest one that satisfies that.
    products: [{ productName: 'A', quantityToLoad: 1 }],
    requestedLoadingDate: '2026-08-30',
  };

  it('uses the ERP DOC_NO, not a timestamp', async () => {
    const { service, create } = build();

    const res = await service.submitLoadingRequest('c-1', dto);

    expect(create.mock.calls[0][0].data.reference).toBe('2310-202606110033');
    expect(res.reference).toBe('2310-202606110033');
    // The old shape must not come back.
    expect(res.reference).not.toMatch(/^WB-\d+$/);
  });

  it('matches what linkedPurchase.erpId reports', async () => {
    // The two are the same value, which is the whole point of the change.
    const { service, create } = build();

    await service.submitLoadingRequest('c-1', dto);

    expect(create.mock.calls[0][0].data.reference).toBe('2310-202606110033');
    expect(create.mock.calls[0][0].data.linkedPurchaseId).toBe('p-1');
  });

  describe('an order loaded in parts', () => {
    it('suffixes the second load rather than failing on the unique index', async () => {
      // reference is @unique and one order already has two loading requests in
      // the live data, so this is a real case, not a hypothetical.
      const create = jest
        .fn()
        .mockRejectedValueOnce(duplicate())
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'lr-2', reference: data.reference, items: [] }),
        );
      const { service } = build(create);

      const res = await service.submitLoadingRequest('c-1', dto);

      expect(create.mock.calls[0][0].data.reference).toBe('2310-202606110033');
      expect(create.mock.calls[1][0].data.reference).toBe(
        '2310-202606110033-02',
      );
      expect(res.reference).toBe('2310-202606110033-02');
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

      const res = await service.submitLoadingRequest('c-1', dto);
      expect(res.reference).toBe('2310-202606110033-04');
    });

    it('retries rather than counting first, so a race cannot collide', async () => {
      // Counting existing rows would let two concurrent submissions compute
      // the same suffix; the loser would fail outright.
      const { service, prisma } = build();
      await service.submitLoadingRequest('c-1', dto);
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
