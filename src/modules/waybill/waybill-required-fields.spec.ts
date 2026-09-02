import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmitLoadingRequestDto } from './dto/waybill.dto';
import { WaybillService } from './waybill.service';

/**
 * What POST /customers/me/waybills insists on.
 *
 * Most of it is the validator's job. Two rules are not, and are enforced in
 * the service instead, because the validator can only see one field at a time:
 *
 *  - at least one product line, which `products` OR `orders` may carry;
 *  - a quantity on every line, under `quantityToLoad` or its former name.
 */
describe('Loading request required fields', () => {
  const BODY = {
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    customerId: 'e8fef5ed-bdc5-4ee2-9902-1839e3c9ddd4',
    requestedLoadingDate: '2026-06-15',
    destination: 'Yaba Warehouse',
    warehouseName: 'LAGOS WAREHOUSE',
    loadingCapacity: 174,
    products: [
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
    ],
  };

  const failures = async (body: Record<string, unknown>) => {
    const errors = await validate(
      plainToInstance(SubmitLoadingRequestDto, body),
    );
    return errors.map((e) => e.property);
  };

  it('accepts the documented body', async () => {
    expect(await failures(BODY)).toEqual([]);
  });

  describe('every field the form sends is required', () => {
    for (const field of [
      'truckPlateNumber',
      'driverName',
      'driverPhone',
      'customerId',
      'requestedLoadingDate',
      'destination',
      'warehouseName',
      'loadingCapacity',
    ]) {
      it(`refuses a body with no ${field}`, async () => {
        const { [field]: _omitted, ...body } = BODY as Record<string, unknown>;

        expect(await failures(body)).toContain(field);
      });
    }
  });

  it('refuses an empty products array', async () => {
    expect(await failures({ ...BODY, products: [] })).toContain('products');
  });

  it('refuses a customerId that is not a uuid', async () => {
    expect(await failures({ ...BODY, customerId: 'not-a-uuid' })).toContain(
      'customerId',
    );
  });

  it('refuses a warehouse that is not one of the three', async () => {
    expect(
      await failures({ ...BODY, warehouseName: 'IBADAN WAREHOUSE' }),
    ).toContain('warehouseName');
  });

  it('still accepts a line using the former name `quantity`', async () => {
    // Declaring quantityToLoad required on the DTO would reject an older
    // client before the service could apply the fallback.
    const body = {
      ...BODY,
      products: [{ productName: 'A', weightPerCarton: 2.7, quantity: 20 }],
    };

    expect(await failures(body)).toEqual([]);
  });

  describe('rules the validator cannot express', () => {
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
        purchase: { findFirst: jest.fn().mockResolvedValue(null) },
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

    const submit = (over: Record<string, unknown>) => {
      const { service, prisma } = build();
      return {
        prisma,
        run: service.submitLoadingRequest('c-1', {
          ...BODY,
          customerId: undefined,
          ...over,
        } as never),
      };
    };

    it('refuses a body carrying no product lines in either shape', async () => {
      const { run, prisma } = submit({ products: undefined });

      await expect(run).rejects.toThrow(/at least one product to load/);
      expect(prisma.loadingRequest.create).not.toHaveBeenCalled();
    });

    it('accepts lines carried by `orders` instead of `products`', async () => {
      // The multi-order form satisfies the same rule.
      const { run, prisma } = submit({
        products: undefined,
        loadingCapacity: 54,
        linkedPurchaseId: undefined,
        orders: {
          'p-1': [
            { productName: 'A', weightPerCarton: 2.7, quantityToLoad: 20 },
          ],
        },
      });
      prisma.purchase.findFirst.mockResolvedValue({
        id: 'p-1',
        erpId: '2310-202606110033',
      });

      await run;

      expect(prisma.loadingRequest.create).toHaveBeenCalled();
    });

    it('refuses a line that states no quantity under either name', async () => {
      const { run } = submit({
        products: [{ productName: 'Mr V Premium Table Water(Lagos)' }],
      });

      await expect(run).rejects.toThrow(
        /"Mr V Premium Table Water\(Lagos\)" states no quantityToLoad/,
      );
    });

    it('refuses another distributor’s customerId', async () => {
      const { run, prisma } = submit({
        customerId: 'e8fef5ed-bdc5-4ee2-9902-1839e3c9ddd4',
      });

      await expect(run).rejects.toThrow(/does not match the signed-in/);
      expect(prisma.loadingRequest.create).not.toHaveBeenCalled();
    });
  });
});
