import { WaybillService } from './waybill.service';

/**
 * The truck must be able to carry the load.
 *
 *   total weight = SUM(quantity x weightPerCarton), across every order
 *
 * checked against `loadingCapacity` BEFORE anything is written, so a rejected
 * request leaves no half-made loading request behind.
 */
describe('Loading request capacity guard', () => {
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
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p-1', erpId: '2310-202606110033' }),
      },
      staff: { findMany: jest.fn().mockResolvedValue([]) },
      loadingRequest: {
        create: jest.fn().mockResolvedValue({ id: 'lr-1', items: [] }),
      },
    };
    return {
      prisma,
      service: new WaybillService(
        prisma as never,
        {
          notify: jest.fn(),
        } as never,
      ),
    };
  };

  const baseDto = {
    warehouseName: 'LAGOS WAREHOUSE',
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    linkedPurchaseId: 'p-1',
    requestedLoadingDate: '2026-09-05',
  };

  const submit = (dto: Record<string, unknown>) => {
    const { service, prisma } = build();
    return {
      prisma,
      run: service.submitLoadingRequest('c-1', {
        ...baseDto,
        ...dto,
      } as never),
    };
  };

  it('accepts a load the truck can carry', async () => {
    // 100 x 9.38 = 938kg into 1,000kg.
    const { run, prisma } = submit({
      loadingCapacity: 1000,
      products: [{ productName: 'A', quantity: 100, weightPerCarton: 9.38 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('accepts a load exactly at capacity', async () => {
    // The limit is "must not exceed", so equal is allowed.
    const { run, prisma } = submit({
      loadingCapacity: 938,
      products: [{ productName: 'A', quantity: 100, weightPerCarton: 9.38 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('refuses a load heavier than the capacity', async () => {
    const { run } = submit({
      loadingCapacity: 900,
      products: [{ productName: 'A', quantity: 100, weightPerCarton: 9.38 }],
    });

    await expect(run).rejects.toThrow(
      /The load weighs 938kg, which exceeds the loading capacity of 900kg by 38kg/,
    );
  });

  it('writes nothing when it refuses', async () => {
    // The check runs before the create, so a rejection leaves no half-made
    // request behind.
    const { run, prisma } = submit({
      loadingCapacity: 10,
      products: [{ productName: 'A', quantity: 100, weightPerCarton: 9.38 }],
    });

    await expect(run).rejects.toThrow();
    expect(prisma.loadingRequest.create).not.toHaveBeenCalled();
  });

  it('weighs the load ACROSS every order, not one at a time', async () => {
    // 100 x 9.38 + 100 x 6.33 = 1,571kg. Each order alone fits in 1,000kg;
    // the truck still cannot take both.
    const { run } = submit({
      loadingCapacity: 1000,
      orders: {
        'p-1': [{ productName: 'A', quantity: 100, weightPerCarton: 9.38 }],
        '2310-202606110033': [
          { productName: 'B', quantity: 100, weightPerCarton: 6.33 },
        ],
      },
    });

    await expect(run).rejects.toThrow(/The load weighs 1571kg/);
  });

  it('falls back to the specification sheet when a line sends no weight', async () => {
    // Otherwise omitting `weightPerCarton` would skip the check for that
    // product. 750ml water is 9.38kg/carton in the sheet.
    const { run } = submit({
      loadingCapacity: 900,
      products: [{ productName: '750ml water(L-水)', quantity: 100 }],
    });

    await expect(run).rejects.toThrow(/The load weighs 938kg/);
  });

  it('lets an unweighable load through rather than guessing', async () => {
    // The sheet does not cover every product. The check never rejects on a
    // figure it cannot stand behind.
    const { run, prisma } = submit({
      loadingCapacity: 1,
      products: [{ productName: 'Nothing the sheet knows', quantity: 5000 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('says how much of the load could not be weighed', async () => {
    // 100 x 9.38 = 938kg counted, one line uncounted: the real load is
    // heavier than the message states, and it says so.
    const { run } = submit({
      loadingCapacity: 900,
      products: [
        { productName: 'A', quantity: 100, weightPerCarton: 9.38 },
        { productName: 'Nothing the sheet knows', quantity: 5000 },
      ],
    });

    await expect(run).rejects.toThrow(
      /1 product line\(s\) carry no carton weight/,
    );
  });

  it('does not check when no capacity was given', async () => {
    // `loadingCapacity` is optional; a request without one states no limit.
    const { run, prisma } = submit({
      products: [{ productName: 'A', quantity: 100000, weightPerCarton: 9.38 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('does not check a request with no product lines at all', async () => {
    const { run, prisma } = submit({
      loadingCapacity: 1,
      quantityCartons: 320,
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('rounds the weight to 2dp rather than reporting float noise', async () => {
    // 3 x 6.33 = 18.990000000000002 in binary floating point.
    const { run } = submit({
      loadingCapacity: 18,
      products: [{ productName: 'A', quantity: 3, weightPerCarton: 6.33 }],
    });

    await expect(run).rejects.toThrow(/weighs 18.99kg/);
  });
});
