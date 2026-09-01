import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OfficerService } from './officer.service';

/**
 * The officer portal's per-distributor tabs must show a distributor EXACTLY
 * what that distributor sees.
 *
 * They are served by the distributor-facing CustomerService itself rather than
 * by a second implementation, so these tests assert the delegation and the
 * scope check around it - the response shape is the customer service's own and
 * is covered by its own specs.
 */
describe('Officer tabs mirror the distributor', () => {
  const OFFICER = { id: 'o-1', role: 'OFFICER' };
  const ADMIN = { id: 'a-1', role: 'ADMIN' };
  const CUSTOMER = {
    id: 'c-1',
    erpId: '10110017',
    updatedAt: new Date('2026-08-19T09:15:00.000Z'),
  };

  const CUSTOMER_LIST = {
    data: [{ id: 'p-1', erpId: '2310-202606110033' }],
    meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
  };
  const STOCK = {
    totalPurchasedCartons: 1000,
    totalLoadedCartons: 400,
    totalRemainingCartons: 600,
    loadingProgress: 40,
    products: [{ productName: 'A', quantityRemaining: 600 }],
  };

  const build = (found: unknown = CUSTOMER) => {
    const prisma = {
      customer: {
        findFirst: jest.fn().mockResolvedValue(found),
        findUnique: jest.fn().mockResolvedValue({
          outstandingBalance: -500,
          updatedAt: CUSTOMER.updatedAt,
        }),
        findMany: jest.fn().mockResolvedValue([
          { erpId: '10110017', updatedAt: CUSTOMER.updatedAt },
          { erpId: '40510009', updatedAt: CUSTOMER.updatedAt },
        ]),
      },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      purchase: {
        aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: null } }),
      },
    };
    const customers = {
      getPurchases: jest.fn().mockResolvedValue(CUSTOMER_LIST),
      getPurchaseDetail: jest.fn().mockResolvedValue({ id: 'p-1', lines: [] }),
      getStockBalanceBreakdown: jest.fn().mockResolvedValue(STOCK),
      getErpWaybills: jest
        .fn()
        .mockResolvedValue({ data: [{ docNo: 'D1' }], meta: { total: 1 } }),
      getErpWaybillDetail: jest
        .fn()
        .mockResolvedValue({ docNo: 'D1', items: [] }),
    };
    const stockBalance = {
      getStockBalanceForCustomers: jest.fn().mockResolvedValue(STOCK),
    };
    const service = new OfficerService(
      prisma as never,
      {} as never,
      stockBalance as never,
      customers as never,
    );
    return { service, prisma, customers, stockBalance };
  };

  describe('Invoices tab', () => {
    it('returns the distributor’s own order list under data/meta', async () => {
      const { service, customers } = build();

      const res = (await service.getCustomerInvoices(OFFICER, 'c-1', {
        page: 2,
        pageSize: 5,
      })) as any;

      // Delegated, not re-queried: the officer cannot see a different history.
      expect(customers.getPurchases).toHaveBeenCalledWith(
        'c-1',
        { page: 2, pageSize: 5 },
        { page: 2, pageSize: 5 },
      );
      expect(res.data).toBe(CUSTOMER_LIST.data);
      expect(res.meta).toBe(CUSTOMER_LIST.meta);
    });

    it('keeps the tab’s own walletBalance and paymentHistory', async () => {
      // Not superseded by the order list - no distributor route carries them.
      const { service } = build();

      const res = (await service.getCustomerInvoices(OFFICER, 'c-1')) as any;

      expect(res.walletBalance).toBe(-500);
      expect(res.paymentHistory).toEqual([]);
      expect(res.lastUpdated).toBeInstanceOf(Date);
    });

    it('stamps lastUpdated from the WHOLE history, not the current page', async () => {
      // Otherwise paging would move the "last synced" stamp.
      const { service, prisma } = build();

      await service.getCustomerInvoices(OFFICER, 'c-1');

      expect(prisma.purchase.aggregate).toHaveBeenCalledWith({
        where: { customerId: 'c-1' },
        _max: { updatedAt: true },
      });
    });

    it('refuses a distributor outside the portfolio', async () => {
      const { service, customers } = build(null);

      await expect(service.getCustomerInvoices(OFFICER, 'c-9')).rejects.toThrow(
        NotFoundException,
      );
      expect(customers.getPurchases).not.toHaveBeenCalled();
    });

    it('checks scope BEFORE reading an order', async () => {
      // An order id from outside, paired with a customer id from inside, must
      // not reach the reader at all.
      const { service, customers } = build(null);

      await expect(
        service.getCustomerInvoiceDetail(OFFICER, 'c-9', 'p-alien'),
      ).rejects.toThrow(NotFoundException);
      expect(customers.getPurchaseDetail).not.toHaveBeenCalled();
    });

    it('reads an order scoped to its customer', async () => {
      const { service, customers } = build();

      await service.getCustomerInvoiceDetail(OFFICER, 'c-1', 'p-1');

      expect(customers.getPurchaseDetail).toHaveBeenCalledWith('c-1', 'p-1');
    });
  });

  describe('Stock tab', () => {
    it('returns the distributor’s own stock balance', async () => {
      const { service, customers } = build();

      const res = (await service.getCustomerStock(OFFICER, 'c-1')) as any;

      expect(customers.getStockBalanceBreakdown).toHaveBeenCalledWith(
        'c-1',
        {},
      );
      expect(res.totalRemainingCartons).toBe(600);
      expect(res.products).toBe(STOCK.products);
      expect(res).not.toHaveProperty('catalogue');
    });

    it('passes the date window straight through', async () => {
      const { service, customers } = build();

      await service.getCustomerStock(OFFICER, 'c-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      expect(customers.getStockBalanceBreakdown).toHaveBeenCalledWith('c-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });
    });
  });

  describe('Waybills tab', () => {
    it('returns the ERP’s documents, not the portal’s loading requests', async () => {
      const { service, customers } = build();

      const res = (await service.getCustomerWaybills(OFFICER, 'c-1', {
        page: 1,
        pageSize: 20,
      })) as any;

      expect(customers.getErpWaybills).toHaveBeenCalledWith('c-1', {
        page: 1,
        pageSize: 20,
      });
      expect(res.data[0].docNo).toBe('D1');
    });

    it('checks scope before reading a document', async () => {
      const { service, customers } = build(null);

      await expect(
        service.getCustomerWaybillDetail(OFFICER, 'c-9', 'D1'),
      ).rejects.toThrow(NotFoundException);
      expect(customers.getErpWaybillDetail).not.toHaveBeenCalled();
    });
  });

  describe('GET /officers/stock — the whole portfolio', () => {
    it('aggregates across the officer’s own distributors', async () => {
      const { service, prisma, stockBalance } = build();

      const res = (await service.getStock(OFFICER)) as any;

      const where = prisma.customer.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('o-1');
      expect(stockBalance.getStockBalanceForCustomers).toHaveBeenCalledWith(
        ['10110017', '40510009'],
        { startDate: null, endDate: null },
      );
      expect(res.customers).toBe(2);
      expect(res.totalRemainingCartons).toBe(600);
    });

    it('gives an ADMIN every distributor, not an empty portfolio', async () => {
      // ADMIN has cross-region visibility everywhere else in this controller.
      const { service, prisma } = build();

      await service.getStock(ADMIN);

      expect(prisma.customer.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('shows only what is still to collect', async () => {
      const { service, stockBalance } = build();
      stockBalance.getStockBalanceForCustomers.mockResolvedValue({
        ...STOCK,
        products: [
          { productName: 'A', quantityRemaining: 600 },
          { productName: 'B', quantityRemaining: 0 },
        ],
      });

      const res = (await service.getStock(OFFICER)) as any;

      expect(res.products).toHaveLength(1);
      expect(res.products[0].productName).toBe('A');
    });

    it('returns honest zeros when the feed says nothing', async () => {
      // Never a silent fallback to some other figure.
      const { service, stockBalance } = build();
      stockBalance.getStockBalanceForCustomers.mockResolvedValue(null);

      const res = (await service.getStock(OFFICER)) as any;

      expect(res).toMatchObject({
        customers: 2,
        totalPurchasedCartons: 0,
        totalLoadedCartons: 0,
        totalRemainingCartons: 0,
        loadingProgress: 0,
        products: [],
      });
    });

    it('rejects a backwards window', async () => {
      const { service } = build();

      await expect(
        service.getStock(OFFICER, {
          startDate: '2026-12-31',
          endDate: '2026-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
