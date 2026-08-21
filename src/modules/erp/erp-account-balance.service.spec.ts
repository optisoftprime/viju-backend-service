import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import {
  ERP_ACCOUNT_BALANCE_RECONCILE_SQL,
  runningBalanceFromCredit,
} from './account-balance';

describe('runningBalanceFromCredit', () => {
  // The three rows below are real records from erp_raw.raw_customer_credit,
  // so the formula stays pinned to what the ERP actually sends.
  it('adds both credit allocations and subtracts consumed credit', () => {
    // 20410008 GLO-BARTH RESOURCES — limit plus a supplementary allocation,
    // nothing consumed.
    expect(
      runningBalanceFromCredit({
        creditAmt: 50000,
        creditAmt1: 20000,
        creditPay: 0,
      }),
    ).toBe(70000);
  });

  it('reads a positive CREDIT_PAY as consumed credit, so the balance goes negative', () => {
    // 10120003 SALES3 — consumed more than the allocation: overdrawn.
    expect(
      runningBalanceFromCredit({
        creditAmt: 0,
        creditAmt1: 500000,
        creditPay: 866000,
      }),
    ).toBe(-366000);
  });

  it('reads a negative CREDIT_PAY as credit in hand, not as debt', () => {
    // 10110017 ISEA INTEGRATED — the customer whose profile read
    // "-33,401,031.14" because the projector copied CREDIT_PAY verbatim.
    // The ERP has them in credit by that amount, plus both allocations.
    expect(
      runningBalanceFromCredit({
        creditAmt: 1000.2222,
        creditAmt1: 1000.1111,
        creditPay: -33401031.14,
      }),
    ).toBe(33403031.4733);
  });

  it('treats missing, blank and non-numeric fields as zero', () => {
    // CREDIT_AMT1 is absent or blank on the overwhelming majority of rows; a
    // NULL must not swallow the whole balance.
    expect(
      runningBalanceFromCredit({
        creditAmt: 1000,
        creditAmt1: '',
        creditPay: null,
      }),
    ).toBe(1000);
    expect(runningBalanceFromCredit({})).toBe(0);
    expect(
      runningBalanceFromCredit({ creditAmt: 'not-a-number', creditAmt1: 5 }),
    ).toBe(5);
  });

  it('parses numeric strings, which is how jsonb ->> hands them back', () => {
    expect(
      runningBalanceFromCredit({
        creditAmt: '1000.2222',
        creditAmt1: '1000.1111',
        creditPay: '-33401031.14',
      }),
    ).toBe(33403031.4733);
  });

  it('keeps every decimal the ERP supplied, without rounding to kobo', () => {
    // The ERP carries 4dp on the credit fields. Rounding here would report
    // 2000.33 and silently drop what the ERP actually stated.
    expect(
      runningBalanceFromCredit({ creditAmt: 1000.2222, creditAmt1: 1000.1111 }),
    ).toBe(2000.3333);

    // 40510002 BINQOM — 3dp on CREDIT_PAY survives too.
    expect(
      runningBalanceFromCredit({
        creditAmt1: 3800000,
        creditPay: -1733971.341,
      }),
    ).toBe(5533971.341);
  });
});

describe('ErpAccountBalanceService', () => {
  let service: ErpAccountBalanceService;

  const mockPrisma = {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErpAccountBalanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ErpAccountBalanceService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ERP_ACCOUNT_BALANCE_SYNC_INTERVAL_MS;
  });

  it('reports unavailable and changes nothing when the credit feed is absent', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ present: false }]);

    await expect(service.reconcile()).resolves.toEqual({
      available: false,
      skipped: false,
      updated: 0,
    });
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('runs the reconcile and reports how many balances moved', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ present: true }]) // isAvailable
      .mockResolvedValueOnce([{ locked: true }]); // advisory lock
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1473);

    await expect(service.reconcile()).resolves.toEqual({
      available: true,
      skipped: false,
      updated: 1473,
    });
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
      ERP_ACCOUNT_BALANCE_RECONCILE_SQL,
    );
  });

  it('skips the pass when another instance holds the advisory lock', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ locked: false }]);

    await expect(service.reconcile()).resolves.toEqual({
      available: true,
      skipped: true,
      updated: 0,
    });
    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns null from getRunningBalance when the ERP holds no credit record', async () => {
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([]);

    await expect(service.getRunningBalance('99999999')).resolves.toBeNull();
  });

  it('returns the derived balance from getRunningBalance, decimals intact', async () => {
    // Postgres hands `numeric` back as a string; every decimal must survive
    // the parse rather than being rounded to kobo.
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ running_balance: '33403031.4733' }]);

    await expect(service.getRunningBalance('10110017')).resolves.toBe(
      33403031.4733,
    );
  });

  it('leaves the periodic reconcile off by default', () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    service.onModuleInit();
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });
});
