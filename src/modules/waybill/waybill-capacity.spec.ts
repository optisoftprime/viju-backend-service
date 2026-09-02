import { WaybillService } from './waybill.service';

/**
 * `loadingCapacity` must EQUAL the weight of the load.
 *
 *   total weight = SUM(quantityToLoad x weightPerCarton)
 *
 * The worked example from the spec: 20 cartons at 2.7kg is 54kg, 24 at 5kg is
 * 120kg, so loadingCapacity must be 174.
 *
 * The field is not a truck's rated capacity the load has to fit inside - the
 * form computes the load's weight and sends it, and this confirms the two
 * agree. Checked before anything is written, so a rejection leaves no
 * half-made loading request behind.
 */
describe('Loading request capacity guard', () => {
  const build = () => {
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

  /** The spec's worked example. */
  const EXAMPLE = [
    {
      productId: '101020104',
      productName: 'Mr V Premium Table Water(Lagos)',
      spec: '100ML',
      weightPerCarton: 2.7,
      quantityLeft: 100,
      quantityToLoad: 20,
    },
    {
      productId: '101010610',
      productName: 'Viju Yoghurt Plain Sweet',
      spec: '750ML',
      weightPerCarton: 5,
      quantityLeft: 120,
      quantityToLoad: 24,
    },
  ];

  it('accepts the worked example: 54 + 120 = 174', async () => {
    const { run, prisma } = submit({
      loadingCapacity: 174,
      products: EXAMPLE,
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('refuses a capacity BELOW the load', async () => {
    const { run } = submit({ loadingCapacity: 100, products: EXAMPLE });

    await expect(run).rejects.toThrow(
      /products weigh 174kg but loadingCapacity says 100kg - a difference of 74kg/,
    );
  });

  it('refuses a capacity ABOVE the load, too', async () => {
    // Not "must fit inside": the two must agree. A capacity larger than the
    // load means the form counted something this request does not list.
    const { run } = submit({ loadingCapacity: 200, products: EXAMPLE });

    await expect(run).rejects.toThrow(/difference of 26kg/);
  });

  it('writes nothing when it refuses', async () => {
    const { run, prisma } = submit({ loadingCapacity: 1, products: EXAMPLE });

    await expect(run).rejects.toThrow();
    expect(prisma.loadingRequest.create).not.toHaveBeenCalled();
  });

  it('is not defeated by floating point', async () => {
    // 20 x 2.7 is 54.00000000000001 in binary floating point, and 3 x 6.33 is
    // 18.990000000000002. Comparing raw floats would reject a correct form.
    const { run, prisma } = submit({
      loadingCapacity: 18.99,
      products: [
        { productName: 'A', weightPerCarton: 6.33, quantityToLoad: 3 },
      ],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('weighs the load ACROSS every order', async () => {
    // 100 x 9.38 + 100 x 6.33 = 1,571kg.
    const { run, prisma } = submit({
      loadingCapacity: 1571,
      orders: {
        'p-1': [
          { productName: 'A', weightPerCarton: 9.38, quantityToLoad: 100 },
        ],
        '2310-202606110033': [
          { productName: 'B', weightPerCarton: 6.33, quantityToLoad: 100 },
        ],
      },
      linkedPurchaseId: 'p-1',
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('falls back to the specification sheet when a line sends no weight', async () => {
    // Otherwise omitting `weightPerCarton` would skip the check for that
    // product. 750ml water is 9.38kg/carton in the sheet, so 100 is 938kg.
    const { run, prisma } = submit({
      loadingCapacity: 938,
      products: [{ productName: '750ml water(L-水)', quantityToLoad: 100 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('lets an unweighable load through rather than guessing', async () => {
    // The sheet does not cover every product - packaging film, freight lines.
    // The check never rejects on a total it cannot stand behind.
    const { run, prisma } = submit({
      loadingCapacity: 1,
      products: [
        { productName: 'Nothing the sheet knows', quantityToLoad: 5000 },
      ],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('does not check when no capacity was given', async () => {
    const { run, prisma } = submit({
      products: [
        { productName: 'A', weightPerCarton: 9.38, quantityToLoad: 100 },
      ],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('refuses a request with no product lines at all', async () => {
    // Nothing to weigh, and nothing to load: refused before the capacity
    // rule is even reached.
    const { run, prisma } = submit({
      loadingCapacity: 1,
      quantityCartons: 320,
    });

    await expect(run).rejects.toThrow(/at least one product to load/);
    expect(prisma.loadingRequest.create).not.toHaveBeenCalled();
  });

  it('still reads the former field name `quantity`', async () => {
    const { run, prisma } = submit({
      loadingCapacity: 938,
      products: [{ productName: 'A', weightPerCarton: 9.38, quantity: 100 }],
    });

    await run;

    expect(prisma.loadingRequest.create).toHaveBeenCalled();
  });

  it('prefers quantityToLoad when both names are sent', async () => {
    const { run } = submit({
      loadingCapacity: 938,
      products: [
        {
          productName: 'A',
          weightPerCarton: 9.38,
          quantity: 999,
          quantityToLoad: 100,
        },
      ],
    });

    // 100 x 9.38 = 938 passes; 999 would not.
    await expect(run).resolves.toBeDefined();
  });
});
