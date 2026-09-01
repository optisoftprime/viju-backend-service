import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CustomerService } from './customer.service';
import { StatementLedgerService } from './statement-ledger.service';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';
import { ErpOrderLinesService } from '../erp/erp-order-lines.service';
import { ErpWaybillsService } from '../erp/erp-waybills.service';
import { ErpFinancialRecordsService } from '../erp/erp-financial-records.service';

/**
 * GET /customers/me/stock-balance?startDate=&endDate=
 *
 * The window narrows the breakdown to orders PLACED inside it. It reaches the
 * ERP query rather than being applied to the result, so the totals and the
 * per-product rows still come from one pass and cannot disagree.
 */
describe('Stock balance date range', () => {
  let service: CustomerService;

  const ERP_RESULT = {
    totalPurchasedCartons: 1000,
    totalLoadedCartons: 400,
    totalRemainingCartons: 600,
    products: [
      {
        itemCode: '101020104',
        productName: 'Mr V Premium Table Water(Lagos)',
        quantityPaid: 800,
        quantityLoaded: 300,
        quantityRemaining: 500,
      },
      {
        itemCode: '101060111',
        productName: 'V-COOL COFFEE(Abuja)',
        quantityPaid: 200,
        quantityLoaded: 200,
        quantityRemaining: 0,
      },
    ],
  };

  const mockPrisma = {
    customer: {
      findUnique: jest.fn().mockResolvedValue({ erpId: '10110017' }),
    },
    purchase: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn(), count: jest.fn() },
    productFlyer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const mockStockBalance = {
    getStockBalance: jest.fn().mockResolvedValue(ERP_RESULT),
    isAvailable: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: StatementLedgerService,
          useValue: { balanceByPurchase: jest.fn() },
        },
        {
          provide: ErpAccountBalanceService,
          useValue: {
            getRunningBalance: jest.fn().mockResolvedValue(0),
            getTemporaryCredit: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: ErpStockBalanceService, useValue: mockStockBalance },
        {
          provide: ErpOrderLinesService,
          useValue: { getLines: jest.fn(), getLinesByOrder: jest.fn() },
        },
        { provide: ErpWaybillsService, useValue: { list: jest.fn() } },
        {
          provide: ErpFinancialRecordsService,
          useValue: { list: jest.fn(), detail: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(CustomerService);
    mockStockBalance.getStockBalance.mockResolvedValue(ERP_RESULT);
    mockStockBalance.isAvailable.mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  it('pushes the window into the ERP query, not onto the result', async () => {
    // Filtering the returned rows would leave the totals describing a
    // different period from the products beneath them.
    await service.getStockBalanceBreakdown('c-1', {
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });

    expect(mockStockBalance.getStockBalance).toHaveBeenCalledWith('10110017', {
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
  });

  it('echoes the applied window back', async () => {
    const res = await service.getStockBalanceBreakdown('c-1', {
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });

    expect(res.dateRange).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    });
  });

  it('accepts one bound alone', async () => {
    await service.getStockBalanceBreakdown('c-1', { startDate: '2026-01-01' });

    expect(mockStockBalance.getStockBalance).toHaveBeenCalledWith('10110017', {
      startDate: '2026-01-01',
      endDate: null,
    });
  });

  it('counts the whole history when no window is sent', async () => {
    const res = await service.getStockBalanceBreakdown('c-1');

    expect(mockStockBalance.getStockBalance).toHaveBeenCalledWith('10110017', {
      startDate: null,
      endDate: null,
    });
    expect(res.dateRange).toEqual({ startDate: null, endDate: null });
    expect(res.totalRemainingCartons).toBe(600);
  });

  it('rejects a backwards window', async () => {
    // Silently returning nothing would read as "you hold no stock".
    await expect(
      service.getStockBalanceBreakdown('c-1', {
        startDate: '2026-06-30',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('still hides products already collected in full', async () => {
    const res = await service.getStockBalanceBreakdown('c-1', {
      startDate: '2026-01-01',
    });

    expect(res.products).toHaveLength(1);
    expect(res.products[0].productName).toBe('Mr V Premium Table Water(Lagos)');
  });

  describe('an empty window', () => {
    beforeEach(() => mockStockBalance.getStockBalance.mockResolvedValue(null));

    it('returns real zeros, NOT the unfiltered local history', async () => {
      // The local fallback knows nothing of the window; letting it answer
      // would report the customer's whole history for a period they ordered
      // nothing in.
      const res = await service.getStockBalanceBreakdown('c-1', {
        startDate: '2030-01-01',
        endDate: '2030-12-31',
      });

      expect(res).toEqual({
        dateRange: { startDate: '2030-01-01', endDate: '2030-12-31' },
        totalPurchasedCartons: 0,
        totalLoadedCartons: 0,
        totalRemainingCartons: 0,
        loadingProgress: 0,
        products: [],
      });
      expect(mockPrisma.purchase.findMany).not.toHaveBeenCalled();
    });

    it('still falls back locally when the feed itself is absent', async () => {
      // "No ERP feed on this database" is not "no orders in that window".
      mockStockBalance.isAvailable.mockResolvedValue(false);

      await service.getStockBalanceBreakdown('c-1', {
        startDate: '2026-01-01',
      });

      expect(mockPrisma.purchase.findMany).toHaveBeenCalled();
    });

    it('applies the same window to the local fallback', async () => {
      mockStockBalance.isAvailable.mockResolvedValue(false);

      await service.getStockBalanceBreakdown('c-1', {
        startDate: '2026-01-01',
        endDate: '2026-06-30',
      });

      const where = mockPrisma.purchase.findMany.mock.calls[0][0].where;
      expect(where.orderDate.gte).toEqual(new Date('2026-01-01'));
      // Exclusive upper bound one day on, so the whole end day is included.
      expect(where.orderDate.lt).toEqual(new Date('2026-07-01'));
    });

    it('leaves the local query unfiltered when no window is sent', async () => {
      mockStockBalance.isAvailable.mockResolvedValue(false);

      await service.getStockBalanceBreakdown('c-1');

      const where = mockPrisma.purchase.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('orderDate');
    });
  });
});
