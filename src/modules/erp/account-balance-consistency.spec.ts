import { AdminService } from '../admin/admin.service';
import { OfficerService } from '../officer/officer.service';
import { CustomerService } from '../customer/customer.service';
import { runningBalanceFromCredit } from './account-balance';

/**
 * One balance, five endpoints.
 *
 * `Customer.outstandingBalance` is written by a projector in another service
 * that copies the ERP's raw CREDIT_PAY into the column, which inverts the sign
 * for every customer holding credit. GET /customers/me has always corrected
 * for that by deriving the figure live from the credit feed
 * (CREDIT_AMT + CREDIT_AMT1 - CREDIT_PAY); the staff-facing endpoints read the
 * stored column, so a distributor and the officer looking at them saw opposite
 * numbers.
 *
 * These tests pin every one of them to the SAME derivation, and to the same
 * fallback when the feed holds nothing.
 */
describe('Account balance consistency across endpoints', () => {
  // ISEA INTEGRATED (10110017), the worked example in account-balance.ts:
  // 1000.2222 + 1000.1111 - (-33401031.14) = 33403031.4733 IN CREDIT,
  // while the stored column says it owes the same amount.
  const ERP_ID = '10110017';
  const DERIVED = 33403031.4733;
  const STORED_INVERTED = -33401031.14;

  const derivedBalances = () => new Map([[ERP_ID, DERIVED]]);

  const customerRow = {
    id: 'c-1',
    erpId: ERP_ID,
    name: 'ISEA INTEGRATED',
    phone: '+2349139580925',
    email: null,
    region: 'LAGOS',
    accountStatus: 'ACTIVE',
    outstandingBalance: STORED_INVERTED,
    assignedOfficerId: null,
    profilePhotoUrl: null,
    createdAt: new Date('2026-08-13T14:06:51.169Z'),
    updatedAt: new Date('2026-08-16T23:01:03.287Z'),
    _count: { supportTickets: 0 },
    officerAssignments: [],
  };

  it('the formula itself matches the ERP worked example', () => {
    expect(
      runningBalanceFromCredit({
        creditAmt: 1000.2222,
        creditAmt1: 1000.1111,
        creditPay: -33401031.14,
      }),
    ).toBe(DERIVED);
  });

  describe('GET /customers/me', () => {
    const build = (balances: Map<string, number>) => {
      const prisma = {
        customer: {
          findUnique: jest.fn().mockResolvedValue({
            ...customerRow,
            assignedOfficer: null,
          }),
        },
      };
      const accountBalance = {
        getRunningBalance: jest
          .fn()
          .mockResolvedValue(balances.get(ERP_ID) ?? null),
      };
      return new CustomerService(
        prisma as never,
        {} as never,
        accountBalance as never,
        // The STOCK column's ERP source. These specs assert the BALANCE
        // column, so it answers "nothing known" and the local fallback stands.
        { stockByErpId: jest.fn().mockResolvedValue(new Map()) } as never,
      );
    };

    it('derives the balance from the ERP credit feed', async () => {
      const profile = await build(derivedBalances()).getProfile('c-1');
      expect(profile.outstandingBalance).toBe(DERIVED);
    });

    it('falls back to the stored column when the feed holds nothing', async () => {
      const profile = await build(new Map()).getProfile('c-1');
      expect(profile.outstandingBalance).toBe(STORED_INVERTED);
    });
  });

  describe('GET /admin/customers and /regional/customers', () => {
    const build = (balances: Map<string, number>) => {
      const prisma = {
        customer: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([customerRow]),
        },
        loadingRequest: { groupBy: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const accountBalance = {
        getRunningBalances: jest.fn().mockResolvedValue(balances),
      };
      return new AdminService(
        prisma as never,
        { notify: jest.fn() } as never,
        { send: jest.fn() },
        {
          getLastSeenByErpIds: jest.fn().mockResolvedValue(new Map()),
        } as never,
        {} as never,
        accountBalance as never,
        // The STOCK column's ERP source. These specs assert the BALANCE
        // column, so it answers "nothing known" and the local fallback stands.
        { stockByErpId: jest.fn().mockResolvedValue(new Map()) } as never,
      );
    };

    it('derives the balance on every row', async () => {
      // GET /regional/customers is the same service call with the region
      // pinned, so it is covered by this too.
      const page = await build(derivedBalances()).getAllCustomers(
        {},
        { page: 1, pageSize: 20 },
      );

      expect(page.data[0].outstandingBalance).toBe(DERIVED);
    });

    it('falls back to the stored column when the feed holds nothing', async () => {
      const page = await build(new Map()).getAllCustomers(
        {},
        { page: 1, pageSize: 20 },
      );

      expect(page.data[0].outstandingBalance).toBe(STORED_INVERTED);
    });

    it('asks the feed once per page, not once per row', async () => {
      const prisma = {
        customer: {
          count: jest.fn().mockResolvedValue(2),
          findMany: jest
            .fn()
            .mockResolvedValue([
              customerRow,
              { ...customerRow, id: 'c-2', erpId: '10110018' },
            ]),
        },
        loadingRequest: { groupBy: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const accountBalance = {
        getRunningBalances: jest.fn().mockResolvedValue(derivedBalances()),
      };
      const service = new AdminService(
        prisma as never,
        { notify: jest.fn() } as never,
        { send: jest.fn() },
        {
          getLastSeenByErpIds: jest.fn().mockResolvedValue(new Map()),
        } as never,
        {} as never,
        accountBalance as never,
        // The STOCK column's ERP source. These specs assert the BALANCE
        // column, so it answers "nothing known" and the local fallback stands.
        { stockByErpId: jest.fn().mockResolvedValue(new Map()) } as never,
      );

      await service.getAllCustomers({}, { page: 1, pageSize: 20 });

      expect(accountBalance.getRunningBalances).toHaveBeenCalledTimes(1);
      expect(accountBalance.getRunningBalances).toHaveBeenCalledWith([
        ERP_ID,
        '10110018',
      ]);
    });
  });

  describe('GET /admin/customers/{id}', () => {
    const build = (balances: Map<string, number>) => {
      const prisma = {
        customer: { findUnique: jest.fn().mockResolvedValue(customerRow) },
        loadingRequest: { groupBy: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const accountBalance = {
        getRunningBalances: jest.fn().mockResolvedValue(balances),
      };
      return new AdminService(
        prisma as never,
        { notify: jest.fn() } as never,
        { send: jest.fn() },
        {
          getLastSeenByErpIds: jest.fn().mockResolvedValue(new Map()),
          getCustomerDetail: jest.fn().mockResolvedValue(null),
        } as never,
        {} as never,
        accountBalance as never,
        // The STOCK column's ERP source. These specs assert the BALANCE
        // column, so it answers "nothing known" and the local fallback stands.
        { stockByErpId: jest.fn().mockResolvedValue(new Map()) } as never,
      );
    };

    it('derives the balance on the detail route', async () => {
      const detail = await build(derivedBalances()).getCustomerDetail('c-1', {
        role: 'ADMIN',
      });

      expect(detail.outstandingBalance).toBe(DERIVED);
    });

    it('falls back to the stored column when the feed holds nothing', async () => {
      const detail = await build(new Map()).getCustomerDetail('c-1', {
        role: 'ADMIN',
      });

      expect(detail.outstandingBalance).toBe(STORED_INVERTED);
    });
  });

  describe('GET /officers/customers', () => {
    const build = (balances: Map<string, number>) => {
      const prisma = {
        customer: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([customerRow]),
        },
        purchase: { groupBy: jest.fn().mockResolvedValue([]) },
        message: { groupBy: jest.fn().mockResolvedValue([]) },
        loadingRequest: { groupBy: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
      const accountBalance = {
        getRunningBalances: jest.fn().mockResolvedValue(balances),
      };
      return new OfficerService(prisma as never, accountBalance as never);
    };

    it('derives walletBalance from the same feed', async () => {
      const page = await build(derivedBalances()).getAssignedCustomers(
        { id: 'o-1', role: 'OFFICER' },
        { page: 1, pageSize: 20 },
      );

      expect(page.data[0].walletBalance).toBe(DERIVED);
    });

    it('falls back to the stored column when the feed holds nothing', async () => {
      const page = await build(new Map()).getAssignedCustomers(
        { id: 'o-1', role: 'OFFICER' },
        { page: 1, pageSize: 20 },
      );

      expect(page.data[0].walletBalance).toBe(STORED_INVERTED);
    });
  });

  describe('GET /officers/customers/{id}', () => {
    const build = (balances: Map<string, number>) => {
      const prisma = {
        customer: { findFirst: jest.fn().mockResolvedValue(customerRow) },
        customerOfficer: { findMany: jest.fn().mockResolvedValue([]) },
        purchase: { findMany: jest.fn().mockResolvedValue([]) },
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        supportTicket: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const accountBalance = {
        getRunningBalances: jest.fn().mockResolvedValue(balances),
      };
      return new OfficerService(prisma as never, accountBalance as never);
    };

    it('derives the balance on the detail route', async () => {
      const detail = await build(derivedBalances()).getCustomerDetail(
        { id: 'o-1', role: 'ADMIN' },
        'c-1',
      );

      expect(detail.outstandingBalance).toBe(DERIVED);
    });

    it('derives the same figure on the overview tab', async () => {
      // A detail page whose header and Overview tab disagree is the exact
      // inconsistency this change exists to remove.
      const overview = await build(derivedBalances()).getCustomerOverview(
        { id: 'o-1', role: 'ADMIN' },
        'c-1',
      );

      expect(overview.walletBalance).toBe(DERIVED);
    });

    it('falls back to the stored column when the feed holds nothing', async () => {
      const detail = await build(new Map()).getCustomerDetail(
        { id: 'o-1', role: 'ADMIN' },
        'c-1',
      );

      expect(detail.outstandingBalance).toBe(STORED_INVERTED);
    });
  });
});
