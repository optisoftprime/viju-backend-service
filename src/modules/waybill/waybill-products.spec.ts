import { WaybillService } from './waybill.service';

/**
 * Submitting a loading request with a product breakdown.
 *
 * The distributor picks the lines from GET /erp/orders/{orderId}/products for
 * the order they are loading against, and sends them back on the request.
 */
describe('Loading request product breakdown', () => {
  const build = () => {
    const created = {
      id: 'lr-1',
      reference: 'WB-123456',
      items: [{ id: 'i-1', productName: 'A', quantity: 120 }],
    };
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
      loadingRequest: { create: jest.fn().mockResolvedValue(created) },
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      service: new WaybillService(prisma as never, notifications as never),
    };
  };

  const baseDto = {
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'Jimoh Ibrahim',
    driverPhone: '+2348012345678',
    linkedPurchaseId: 'p-1',
    requestedLoadingDate: '2026-08-30',
  };

  const products = [
    {
      productId: '101020104',
      productName: '750ml water(L-水)',
      quantity: 120,
      weightPerCarton: 9.38,
    },
    {
      productId: null,
      productName: '18.9L water(L)',
      quantity: 80,
      weightPerCarton: null,
    },
  ];

  it('stores the product lines as sent', async () => {
    const { service, prisma } = build();

    await service.submitLoadingRequest('c-1', {
      ...baseDto,
      warehouseName: 'LAGOS WAREHOUSE',
      loadingCapacity: 1200,
      products,
    } as never);

    const data = prisma.loadingRequest.create.mock.calls[0][0].data;
    // Every line is attributed to the linked order, so the single-order body
    // and the `orders` map produce the same rows.
    expect(data.items.create).toEqual([
      {
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        productId: '101020104',
        productName: '750ml water(L-水)',
        quantity: 120,
        weightPerCarton: 9.38,
      },
      {
        purchaseId: 'p-1',
        orderReference: '2310-202606110033',
        productId: null,
        productName: '18.9L water(L)',
        quantity: 80,
        weightPerCarton: null,
      },
    ]);
  });

  it('accepts a null productId and weightPerCarton', async () => {
    // The products endpoint returns nulls where the specification sheet has no
    // entry, so the submit body has to take them back.
    const { service, prisma } = build();

    await service.submitLoadingRequest('c-1', {
      ...baseDto,
      products: [products[1]],
    });

    const line =
      prisma.loadingRequest.create.mock.calls[0][0].data.items.create[0];
    expect(line).toMatchObject({ productId: null, weightPerCarton: null });
  });

  describe('quantityCartons is derived, not trusted', () => {
    it('sums the line quantities', async () => {
      // 120 + 80. Every stock calculation reads quantityCartons on COMPLETED
      // requests, so it must agree with the lines rather than sit beside them.
      const { service, prisma } = build();

      await service.submitLoadingRequest('c-1', {
        ...baseDto,
        products,
      });

      expect(
        prisma.loadingRequest.create.mock.calls[0][0].data.quantityCartons,
      ).toBe(200);
    });

    it('ignores a quantityCartons that disagrees with the lines', async () => {
      const { service, prisma } = build();

      await service.submitLoadingRequest('c-1', {
        ...baseDto,
        quantityCartons: 9999,
        products,
      });

      expect(
        prisma.loadingRequest.create.mock.calls[0][0].data.quantityCartons,
      ).toBe(200);
    });

    it('does NOT confuse the load with the truck capacity', async () => {
      // loadingCapacity is what the truck holds; the load is the lines.
      const { service, prisma } = build();

      await service.submitLoadingRequest('c-1', {
        ...baseDto,
        loadingCapacity: 1200,
        products,
      });

      const data = prisma.loadingRequest.create.mock.calls[0][0].data;
      expect(data.loadingCapacity).toBe(1200);
      expect(data.quantityCartons).toBe(200);
    });

    it('keeps the old behaviour when no products are sent', async () => {
      const { service, prisma } = build();

      await service.submitLoadingRequest('c-1', {
        ...baseDto,
        quantityCartons: 320,
        destination: 'Yaba Warehouse',
      });

      const data = prisma.loadingRequest.create.mock.calls[0][0].data;
      expect(data.quantityCartons).toBe(320);
      expect(data.destination).toBe('Yaba Warehouse');
      expect(data.items).toBeUndefined();
    });
  });

  it('records the warehouse', async () => {
    const { service, prisma } = build();

    await service.submitLoadingRequest('c-1', {
      ...baseDto,
      warehouseName: 'ABUJA WAREHOUSE',
      products,
    } as never);

    expect(
      prisma.loadingRequest.create.mock.calls[0][0].data.warehouseName,
    ).toBe('ABUJA WAREHOUSE');
  });

  it('returns the created lines as `products`, matching the request body', async () => {
    const { service } = build();

    const res = await service.submitLoadingRequest('c-1', {
      ...baseDto,
      products,
    });

    expect(res).toHaveProperty('products');
    expect(res).not.toHaveProperty('items');
  });

  it('still refuses a linked order that is not the caller’s', async () => {
    const { service, prisma } = build();
    prisma.purchase.findFirst.mockResolvedValue(null);

    await expect(
      service.submitLoadingRequest('c-1', { ...baseDto, products }),
    ).rejects.toThrow(/Linked order not found/);
  });
});
