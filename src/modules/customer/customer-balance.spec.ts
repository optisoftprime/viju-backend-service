import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CustomerService } from './customer.service';
import { StatementLedgerService } from './statement-ledger.service';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';

/**
 * The balance the customer app shows must come from the ERP credit feed
 * (CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY), not from the stored
 * `Customer.outstandingBalance` column — the projector that writes that column
 * copies raw CREDIT_PAY into it, inverting the sign for every customer holding
 * credit.
 *
 * ISEA INTEGRATED (10110017) is the live example throughout: stored column
 * -33,401,031.14, true ERP balance +33,403,031.4733.
 */
describe('Customer account balance (ERP-derived)', () => {
  let service: CustomerService;

  const STORED = -33401031.14;
  const DERIVED = 33403031.4733;

  const ISEA = {
    id: 'cust-isea',
    erpId: '10110017',
    name: 'ISEA INTEGRATED',
    phone: '+2349139580925',
    email: null,
    region: 'LAGOS',
    accountStatus: 'ACTIVE',
    outstandingBalance: STORED,
    profilePhotoUrl: null,
    updatedAt: new Date('2026-08-22T05:29:16.517Z'),
    assignedOfficer: null,
  };

  const mockPrisma = {
    customer: { findUnique: jest.fn() },
    purchase: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    productFlyer: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const mockAccountBalance = { getRunningBalance: jest.fn() };

  const mockLedger = {
    balanceByPurchase: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StatementLedgerService, useValue: mockLedger },
        { provide: ErpAccountBalanceService, useValue: mockAccountBalance },
      ],
    }).compile();
    service = module.get(CustomerService);
    mockPrisma.customer.findUnique.mockResolvedValue(ISEA);
  });

  afterEach(() => jest.clearAllMocks());

  describe('GET /customers/me', () => {
    it('returns the ERP-derived balance, not the stored column', async () => {
      mockAccountBalance.getRunningBalance.mockResolvedValue(DERIVED);

      const profile = await service.getProfile(ISEA.id);

      expect(profile.outstandingBalance).toBe(DERIVED);
      expect(profile.outstandingBalance).not.toBe(STORED);
      expect(mockAccountBalance.getRunningBalance).toHaveBeenCalledWith(
        '10110017',
      );
    });

    it('falls back to the stored column when the ERP holds no credit record', async () => {
      mockAccountBalance.getRunningBalance.mockResolvedValue(null);

      const profile = await service.getProfile(ISEA.id);

      expect(profile.outstandingBalance).toBe(STORED);
    });

    it('keeps every decimal — no rounding to kobo', async () => {
      mockAccountBalance.getRunningBalance.mockResolvedValue(DERIVED);

      const profile = await service.getProfile(ISEA.id);

      expect(profile.outstandingBalance.toString()).toBe('33403031.4733');
    });
  });

  describe('GET /customers/me/home', () => {
    it('reports the derived balance and flips isLow with it', async () => {
      mockAccountBalance.getRunningBalance.mockResolvedValue(DERIVED);

      const home = await service.getHome(ISEA.id);

      expect(home.accountBalance.amount).toBe(DERIVED);
      // The stored column was negative, so isLow used to read true. The ERP
      // has this customer in credit, so it must now be false.
      expect(home.accountBalance.isLow).toBe(false);
    });

    it('still flags a genuinely overdrawn customer', async () => {
      // 10120003 SALES3: 0 + 500000 − 866000 = −366000.
      mockAccountBalance.getRunningBalance.mockResolvedValue(-366000);

      const home = await service.getHome(ISEA.id);

      expect(home.accountBalance.amount).toBe(-366000);
      expect(home.accountBalance.isLow).toBe(true);
    });
  });

  describe('GET /customers/me/invoices', () => {
    it('reports the derived balance and derives isOverdue from it', async () => {
      mockAccountBalance.getRunningBalance.mockResolvedValue(DERIVED);

      const invoices = await service.getInvoices(ISEA.id);

      expect(invoices.walletBalance.amount).toBe(DERIVED);
      expect(invoices.walletBalance.isOverdue).toBe(false);
    });
  });
});
