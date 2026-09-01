import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CustomerService } from './customer.service';
import { StatementLedgerService } from './statement-ledger.service';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';
import { ErpOrderLinesService } from '../erp/erp-order-lines.service';
import { ErpWaybillsService } from '../erp/erp-waybills.service';
import { ErpFinancialRecordsService } from '../erp/erp-financial-records.service';

/**
 * Order history and order detail.
 *
 * The list renders one row per ORDER and carries no line items. The detail
 * carries them, merged so a product appears once - the ERP writes a separate
 * line whenever the same product is priced differently on one order.
 */
describe('Order history and detail lines', () => {
  let service: CustomerService;

  const ORDER = {
    id: 'a1ce5c0f-36b3-4930-b4ef-8839e8f1db68',
    erpId: '2310-202606110033',
    customerId: 'c-1',
    orderDate: new Date('2026-06-11T00:00:00.000Z'),
    status: 'CLOSED',
    statusUpdatedAt: null,
    totalItems: 4264,
    totalValue: 9942000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Four raw lines, two products. The zero-priced rows are free goods.
  const RAW_ITEMS = [
    {
      id: '445828',
      productName: 'Mr V Premium Table Water(Abuja)',
      itemCode: '101020105',
      quantity: 1700,
      unitPrice: 1500,
      lineTotal: 2550000,
    },
    {
      id: '445829',
      productName: 'Mr V Premium Table Water(Abuja)',
      itemCode: '101020105',
      quantity: 68,
      unitPrice: 0,
      lineTotal: 0,
    },
    {
      id: '445830',
      productName: 'V-COOL COFFEE(Abuja)',
      itemCode: '101060111',
      quantity: 2400,
      unitPrice: 3080,
      lineTotal: 7392000,
    },
    {
      id: '445831',
      productName: 'V-COOL COFFEE(Abuja)',
      itemCode: '101060111',
      quantity: 96,
      unitPrice: 0,
      lineTotal: 0,
    },
  ];

  const mockPrisma = {
    customer: { findUnique: jest.fn() },
    purchase: {
      findMany: jest.fn().mockResolvedValue([ORDER]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue({ ...ORDER, items: RAW_ITEMS }),
    },
    payment: { findMany: jest.fn(), count: jest.fn() },
    productFlyer: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const mockOrderLines = {
    getLines: jest.fn().mockResolvedValue([]),
    getLinesByOrder: jest.fn().mockResolvedValue(new Map()),
  };
  const mockLedger = {
    balanceByPurchase: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StatementLedgerService, useValue: mockLedger },
        {
          provide: ErpAccountBalanceService,
          useValue: {
            getRunningBalance: jest.fn().mockResolvedValue(0),
            getTemporaryCredit: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: ErpStockBalanceService,
          useValue: { getStockBalance: jest.fn().mockResolvedValue(null) },
        },
        { provide: ErpOrderLinesService, useValue: mockOrderLines },
        { provide: ErpWaybillsService, useValue: { list: jest.fn() } },
        {
          provide: ErpFinancialRecordsService,
          useValue: { list: jest.fn(), detail: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(CustomerService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('GET /customers/me/invoices - the list', () => {
    it('returns no line array on the rows', async () => {
      const res = await service.getPurchases('c-1', {} as never, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0]).not.toHaveProperty('items');
      expect(res.data[0]).not.toHaveProperty('lines');
      expect(res.data[0]).toMatchObject({
        id: ORDER.id,
        erpId: ORDER.erpId,
        totalItems: 4264,
        totalValue: 9942000,
      });
    });

    it('no longer reaches for the ERP feed to fill lines', async () => {
      // That lookup ran on every page and returned lines nothing displays.
      await service.getPurchases('c-1', {} as never, { page: 1, pageSize: 20 });

      expect(mockOrderLines.getLinesByOrder).not.toHaveBeenCalled();
    });

    it('still filters on product name', async () => {
      // `search` is a WHERE clause; dropping the payload must not drop it.
      await service.getPurchases('c-1', { search: 'COFFEE' } as never, {
        page: 1,
        pageSize: 20,
      });

      const where = mockPrisma.purchase.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('COFFEE');
      expect(JSON.stringify(where)).toContain('productName');
    });
  });

  describe('GET /customers/me/invoices/{id} - the detail', () => {
    const detail = () => service.getPurchaseDetail('c-1', ORDER.id);

    it('shows each product once', async () => {
      const res = (await detail()) as any;

      expect(res.lines).toHaveLength(2);
      expect(res.lines.map((l: any) => l.itemCode)).toEqual([
        '101020105',
        '101060111',
      ]);
    });

    it('sums the quantities of the merged lines', async () => {
      const res = (await detail()) as any;

      expect(res.lines[0].quantity).toBe(1768); // 1700 + 68
      expect(res.lines[1].quantity).toBe(2496); // 2400 + 96
      // The merged quantities must still account for the whole order.
      const total = res.lines.reduce((s: number, l: any) => s + l.quantity, 0);
      expect(total).toBe(res.totalItems);
    });

    it('sums the money so the lines still reconcile with totalValue', async () => {
      const res = (await detail()) as any;

      expect(res.lines[0].amount).toBe(2550000);
      expect(res.lines[1].amount).toBe(7392000);
      const total = res.lines.reduce((s: number, l: any) => s + l.amount, 0);
      expect(total).toBe(res.totalValue);
    });

    it('reports the EFFECTIVE unit price when the parts disagreed', async () => {
      // 2,550,000 / 1,768 = 1442.31. Keeping 1500 would imply 2,652,000 and
      // overstate the line against `amount`.
      const res = (await detail()) as any;

      expect(res.lines[0].unitPrice).toBe(1442.31);
      // Rounded to 2dp it cannot multiply back to the exact naira - `amount`
      // stays authoritative - but it must be right to within that rounding.
      const implied = res.lines[0].quantity * res.lines[0].unitPrice;
      expect(Math.abs(implied - res.lines[0].amount)).toBeLessThan(
        res.lines[0].quantity * 0.01,
      );
    });

    it('keeps the unit price untouched when every part agreed', async () => {
      mockPrisma.purchase.findFirst.mockResolvedValueOnce({
        ...ORDER,
        items: [
          { ...RAW_ITEMS[0] },
          { ...RAW_ITEMS[1], unitPrice: 1500, lineTotal: 102000 },
        ],
      });

      const res = (await detail()) as any;

      expect(res.lines[0].unitPrice).toBe(1500);
      expect(res.lines[0].quantity).toBe(1768);
      expect(res.lines[0].amount).toBe(2652000);
    });

    it('does not turn a null amount into zero', async () => {
      // ERP-sourced lines state no per-line money; null must stay null rather
      // than reading as a free line.
      mockPrisma.purchase.findFirst.mockResolvedValueOnce({
        ...ORDER,
        items: [
          { ...RAW_ITEMS[0], unitPrice: null, lineTotal: null },
          { ...RAW_ITEMS[1], unitPrice: null, lineTotal: null },
        ],
      });

      const res = (await detail()) as any;

      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].quantity).toBe(1768);
      expect(res.lines[0].amount).toBeNull();
      expect(res.lines[0].unitPrice).toBeNull();
    });

    it('merges on the product name when the feed gives no itemCode', async () => {
      mockPrisma.purchase.findFirst.mockResolvedValueOnce({
        ...ORDER,
        items: [
          { ...RAW_ITEMS[0], itemCode: null },
          { ...RAW_ITEMS[1], itemCode: null },
        ],
      });

      const res = (await detail()) as any;

      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].quantity).toBe(1768);
    });

    it('does not merge two genuinely different products', async () => {
      mockPrisma.purchase.findFirst.mockResolvedValueOnce({
        ...ORDER,
        items: [RAW_ITEMS[0], RAW_ITEMS[2]],
      });

      const res = (await detail()) as any;

      expect(res.lines).toHaveLength(2);
    });

    it('leaves the legacy `items` array unmerged', async () => {
      // Older screens read it and expect one entry per raw ERP line.
      const res = (await detail()) as any;

      expect(res.items).toHaveLength(4);
    });
  });
});
