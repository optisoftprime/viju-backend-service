import { WaybillService } from './waybill.service';

/**
 * `quantityToLoad` may not exceed what is still left to collect.
 *
 * Loading more of a product than the distributor is owed is not a load the
 * depot can fill, and it would overstate the account's outstanding stock.
 *
 * The rule is applied twice, because neither source is sufficient alone: the
 * `quantityLeft` on the line is what the distributor was shown but is
 * supplied by the caller, and the ERP's own figure cannot be talked past but
 * is not always available.
 */
describe('Loading request quantity guard', () => {
  /** What the ERP says this distributor still has to collect. */
  const OUTSTANDING = [
    {
      productId: '101020104',
      productName: 'Mr V Premium Table Water(Abuja)',
      spec: '750ML(L)',
      weightPerCarton: null,
      quantityLeft: 150,
    },
    {
      productId: null,
      productName: '18.9L water(L)',
      spec: null,
      weightPerCarton: null,
      quantityLeft: 40,
    },
  ];

  const build = (outstanding: unknown[] = OUTSTANDING) => {
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
      purchase: { findFirst: jest.fn().mockResolvedValue(null) },
      staff: { findMany: jest.fn().mockResolvedValue([]) },
      loadingRequest: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'lr-1',
            reference: data.reference,
            items: [],
          }),
        ),
      },
    };
    return {
      prisma,
      service: new WaybillService(
        prisma as never,
        { notify: jest.fn() } as never,
        {
          listForCustomer: async () => outstanding,
        } as never,
      ),
    };
  };

  const baseDto = {
    warehouseName: 'LAGOS WAREHOUSE',
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    // No loadingCapacity: that rule has its own spec, and it would otherwise
    // reject these bodies before this one is reached.
    requestedLoadingDate: '2026-08-30',
  };

  const submit = (products: unknown[], outstanding?: unknown[]) => {
    const { service, prisma } = build(outstanding);
    return {
      prisma,
      run: () =>
        service.submitLoadingRequest('c-1', { ...baseDto, products } as never),
    };
  };

  describe('against the quantityLeft the line carries', () => {
    it('refuses a line loading more than is left', async () => {
      const { run } = submit([
        {
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 120,
          quantityLeft: 100,
        },
      ]);

      await expect(run()).rejects.toThrow(
        /quantityToLoad is 120 but only 100 carton\(s\) are left/,
      );
    });

    it('names the product the distributor typed too much against', async () => {
      const { run } = submit([
        { productName: 'A', quantityToLoad: 1, quantityLeft: 10 },
        { productName: '18.9L water(L)', quantityToLoad: 50, quantityLeft: 40 },
      ]);

      await expect(run()).rejects.toThrow(/"18\.9L water\(L\)"/);
    });

    it('accepts a line loading exactly what is left', async () => {
      const { run, prisma } = submit([
        {
          productId: '101020104',
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 150,
          quantityLeft: 150,
        },
      ]);

      await run();
      expect(prisma.loadingRequest.create).toHaveBeenCalled();
    });

    it('still checks when the line omits quantityLeft', async () => {
      // Omitting it must not be a way to skip the rule - the ERP figure
      // stands in.
      const { run } = submit([
        { productName: '18.9L water(L)', quantityToLoad: 41 },
      ]);

      await expect(run()).rejects.toThrow(/only 40 carton\(s\) are left/);
    });
  });

  describe("against the ERP's own outstanding figure", () => {
    it('sums the request lines per product before comparing', async () => {
      // No single line is over 150, but together they ask for 180.
      const { run } = submit([
        {
          productId: '101020104',
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 90,
        },
        {
          productId: '101020104',
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 90,
        },
      ]);

      await expect(run()).rejects.toThrow(
        /quantityToLoad is 180 but only 150 carton\(s\) are left/,
      );
    });

    it('matches on item code even when the name differs', async () => {
      const { run } = submit([
        {
          productId: '101020104',
          productName: 'renamed upstream',
          quantityToLoad: 200,
        },
      ]);

      await expect(run()).rejects.toThrow(/only 150 carton\(s\) are left/);
    });

    it('cannot be talked past by an inflated quantityLeft', async () => {
      // The caller supplies quantityLeft, so rule 1 would wave this through.
      const { run } = submit([
        {
          productId: '101020104',
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 500,
          quantityLeft: 9999,
        },
      ]);

      await expect(run()).rejects.toThrow(/only 150 carton\(s\) are left/);
    });

    it('accepts a load within the outstanding quantity', async () => {
      const { run, prisma } = submit([
        {
          productId: '101020104',
          productName: 'Mr V Premium Table Water(Abuja)',
          quantityToLoad: 100,
        },
        { productName: '18.9L water(L)', quantityToLoad: 40 },
      ]);

      await run();
      expect(prisma.loadingRequest.create).toHaveBeenCalled();
    });
  });

  describe('a figure it cannot stand behind', () => {
    it('lets the load through when the ERP feed is silent', async () => {
      // An absent feed is not evidence the distributor is owed nothing.
      const { run, prisma } = submit(
        [{ productName: 'anything', quantityToLoad: 10_000 }],
        [],
      );

      await run();
      expect(prisma.loadingRequest.create).toHaveBeenCalled();
    });

    it('skips a product the feed does not know rather than refusing', async () => {
      // An unmatched name is as likely to be a naming mismatch as an invented
      // product, so it falls back to rule 1 alone.
      const { run, prisma } = submit([
        {
          productName: 'a product the feed never mentions',
          quantityToLoad: 10,
        },
      ]);

      await run();
      expect(prisma.loadingRequest.create).toHaveBeenCalled();
    });
  });
});
