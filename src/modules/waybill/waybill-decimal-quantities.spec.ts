import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  LoadingRequestProductDto,
  SubmitLoadingRequestDto,
} from './dto/waybill.dto';
import { WaybillService } from './waybill.service';

/**
 * Loading quantities are FRACTIONAL.
 *
 * The ERP states fractional quantities on 5,799 of its sales-order lines, and
 * GET /erp/orders/{customerId}/products passes them through to `quantityLeft`
 * untouched. A distributor shown "12.5 left to collect" has to be able to
 * state it; the integer validators used to reject that outright.
 */
describe('Fractional loading quantities', () => {
  const errorsOn = async (dto: object, cls: any) => {
    const errors = await validate(plainToInstance(cls, dto));
    return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
  };

  describe('the product line', () => {
    it('accepts a fractional quantityToLoad', async () => {
      expect(
        await errorsOn(
          { productName: 'A', quantityToLoad: 12.5 },
          LoadingRequestProductDto,
        ),
      ).toEqual([]);
    });

    it('accepts a fractional quantityLeft', async () => {
      expect(
        await errorsOn(
          { productName: 'A', quantityToLoad: 1, quantityLeft: 20.75 },
          LoadingRequestProductDto,
        ),
      ).toEqual([]);
    });

    it('still refuses a negative quantity', async () => {
      expect(
        await errorsOn(
          { productName: 'A', quantityToLoad: -0.5 },
          LoadingRequestProductDto,
        ),
      ).toContain('min');
    });
  });

  describe('loadingCapacity', () => {
    const base = {
      truckPlateNumber: 'LAG-234-XY',
      driverName: 'Jimoh Ibrahim',
      driverPhone: '+2348012345678',
      customerId: 'e8fef5ed-bdc5-4ee2-e902-1839e3c9ddd4',
      requestedLoadingDate: '2026-06-15',
      destination: 'Yaba Warehouse',
      warehouseName: 'LAGOS WAREHOUSE',
      products: [{ productName: 'A', quantityToLoad: 1 }],
    };

    it('accepts a fractional capacity', async () => {
      const errors = await validate(
        plainToInstance(SubmitLoadingRequestDto, {
          ...base,
          loadingCapacity: 117.25,
        }),
      );
      expect(errors.map((e) => e.property)).not.toContain('loadingCapacity');
    });

    it('still refuses zero and negatives', async () => {
      for (const loadingCapacity of [0, -1]) {
        const errors = await validate(
          plainToInstance(SubmitLoadingRequestDto, {
            ...base,
            loadingCapacity,
          }),
        );
        expect(errors.map((e) => e.property)).toContain('loadingCapacity');
      }
    });
  });

  describe('the quantity guard', () => {
    // A fractional load must be compared fractionally, not rounded first.
    const build = (outstanding: unknown[]) => {
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
          { listForCustomer: async () => outstanding } as never,
        ),
      };
    };

    const dto = (products: unknown[]) => ({
      truckPlateNumber: 'LAG-234-XY',
      driverName: 'Jimoh Ibrahim',
      driverPhone: '+2348012345678',
      requestedLoadingDate: '2026-06-15',
      warehouseName: 'LAGOS WAREHOUSE',
      products,
    });

    it('lets a fractional load through when it fits', async () => {
      const { service, prisma } = build([
        {
          productId: '101020104',
          productName: 'A',
          spec: null,
          weightPerCarton: null,
          quantityLeft: 12.5,
        },
      ]);

      await service.submitLoadingRequest(
        'c-1',
        dto([
          { productId: '101020104', productName: 'A', quantityToLoad: 12.5 },
        ]) as never,
      );

      expect(prisma.loadingRequest.create).toHaveBeenCalled();
      const data = prisma.loadingRequest.create.mock.calls[0][0].data;
      // Stored as sent, not truncated to 12.
      expect(data.items.create[0].quantity).toBe(12.5);
      expect(data.quantityCartons).toBe(12.5);
    });

    it('refuses a load that exceeds a fractional quantityLeft', async () => {
      const { service } = build([
        {
          productId: '101020104',
          productName: 'A',
          spec: null,
          weightPerCarton: null,
          quantityLeft: 12.5,
        },
      ]);

      await expect(
        service.submitLoadingRequest(
          'c-1',
          dto([
            { productId: '101020104', productName: 'A', quantityToLoad: 12.75 },
          ]) as never,
        ),
      ).rejects.toThrow(/only 12\.5 carton\(s\) are left/);
    });
  });
});
