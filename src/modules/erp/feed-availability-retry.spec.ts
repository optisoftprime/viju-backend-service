import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpCustomerProjectionService } from './erp-customer-projection.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';

/**
 * A probe that THREW must not be cached as "the feed is absent".
 *
 * Production showed this at boot:
 *
 *   ERROR [ErpOrderStatusService] Could not probe erp_raw.raw_sales_order:
 *   Server has closed the connection.. Treating it as absent.
 *
 * The database had dropped the connection for a moment. Because the failure
 * was cached, that container then behaved for the REST OF ITS LIFE as though
 * the ERP feed did not exist: no order-status reconcile, no customer
 * projection, and every stock and balance figure silently falling back to the
 * local projection. One blip at start-up, degraded until someone restarted it.
 *
 * Only a probe that ANSWERS is conclusive. A probe that failed is retried.
 */
describe('ERP feed availability survives a dropped connection', () => {
  /** A probe that fails once, then reports the table is there. */
  const flaky = () => {
    const queryRawUnsafe = jest
      .fn()
      .mockRejectedValueOnce(new Error('Server has closed the connection.'))
      .mockResolvedValue([{ present: true }]);
    return { prisma: { $queryRawUnsafe: queryRawUnsafe }, queryRawUnsafe };
  };

  const services: [
    string,
    (prisma: unknown) => { isAvailable(): Promise<boolean> },
  ][] = [
    ['ErpOrderStatusService', (p) => new ErpOrderStatusService(p as never)],
    [
      'ErpCustomerProjectionService',
      (p) => new ErpCustomerProjectionService(p as never),
    ],
    [
      'ErpStockBalanceService',
      (p) => new ErpStockBalanceService(p as never, {} as never),
    ],
  ];

  for (const [name, make] of services) {
    describe(name, () => {
      it('reports unavailable for the failed call, then recovers', async () => {
        const { prisma } = flaky();
        const service = make(prisma);

        expect(await service.isAvailable()).toBe(false);
        // The very next call probes again rather than trusting the failure.
        expect(await service.isAvailable()).toBe(true);
      });

      it('does not re-probe once it has a real answer', async () => {
        // The cache still does its job for a CONCLUSIVE result.
        const queryRawUnsafe = jest.fn().mockResolvedValue([{ present: true }]);
        const service = make({ $queryRawUnsafe: queryRawUnsafe });

        await service.isAvailable();
        await service.isAvailable();
        await service.isAvailable();

        expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
      });

      it('caches a genuine absence, so CI does not probe on every call', async () => {
        const queryRawUnsafe = jest
          .fn()
          .mockResolvedValue([{ present: false }]);
        const service = make({ $queryRawUnsafe: queryRawUnsafe });

        expect(await service.isAvailable()).toBe(false);
        expect(await service.isAvailable()).toBe(false);

        expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
      });
    });
  }
});
