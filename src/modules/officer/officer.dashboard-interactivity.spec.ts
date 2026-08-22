import { OfficerService } from './officer.service';

/**
 * Account Officer dashboard interactivity - AO-C1, AO-P1, AO-P2, AO-D1.
 *
 * The tiles are click-through: Total Customers opens the list, Open Tickets
 * and Unread Messages jump to the customer that owns one. That only works if
 * the tile and the list count the same rows, and if each row says WHICH
 * customer is waiting.
 */
describe('Officer customer list (AO-C1, AO-P1, AO-P2)', () => {
  const customerRow = (id: string, name: string) => ({
    id,
    name,
    erpId: '1011000' + id,
    phone: '+2348168584112',
    region: 'LAGOS',
    outstandingBalance: -10140600.1232,
    accountStatus: 'ACTIVE',
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    _count: { supportTickets: 2 },
  });

  const build = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([customerRow('1', 'ADLAK')]),
        findFirst: jest.fn().mockResolvedValue({ id: '1' }),
      },
      purchase: { groupBy: jest.fn().mockResolvedValue([]) },
      message: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      supportTicket: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      loadingRequest: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
    // The ERP credit feed is absent in tests, which is the documented
    // fallback path: balances come from the stored column.
    const accountBalance = {
      getRunningBalances: jest.fn().mockResolvedValue(new Map()),
    };
    return {
      prisma,
      accountBalance,
      service: new OfficerService(prisma as never, accountBalance as never),
    };
  };

  const officer = { id: 'o-1', role: 'OFFICER' };

  describe('AO-C1 - which customer has an unread message', () => {
    it('returns unreadMessages and lastMessageAt on every row', async () => {
      const { service } = build({
        message: {
          groupBy: jest
            .fn()
            // 1st call: last message on the thread (either side).
            .mockResolvedValueOnce([
              {
                customerId: '1',
                _max: { createdAt: new Date('2026-08-22T07:41:00.000Z') },
              },
            ])
            // 2nd call: unread messages FROM the distributor.
            .mockResolvedValueOnce([{ customerId: '1', _count: { _all: 3 } }]),
          count: jest.fn(),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0]).toMatchObject({
        unreadMessages: 3,
        lastMessageAt: new Date('2026-08-22T07:41:00.000Z'),
      });
    });

    it('reports 0 rather than omitting the field when nothing is waiting', async () => {
      const { service } = build();

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0].unreadMessages).toBe(0);
      // lastMessageAt is null on an empty thread; lastContactDate keeps its
      // documented fallback to customer.updatedAt.
      expect(res.data[0].lastMessageAt).toBeNull();
      expect(res.data[0].lastContactDate).toEqual(
        new Date('2026-08-10T00:00:00.000Z'),
      );
    });

    it('filters to the customers waiting on the officer', async () => {
      const { service, prisma } = build();

      await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
        unreadMessages: true,
      });

      const where = prisma.customer.count.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        messages: { some: { senderType: 'CUSTOMER', readAt: null } },
      });
    });

    it('counts the unread filter into meta.total, not just the page', async () => {
      // The pager must agree with the rows: filtering happens in SQL, so the
      // count query carries the same where-clause as the page query.
      const { service, prisma } = build();

      await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
        unreadMessages: true,
      });

      expect(prisma.customer.count.mock.calls[0][0].where).toEqual(
        prisma.customer.findMany.mock.calls[0][0].where,
      );
    });

    it('counts the same messages the dashboard tile counts', async () => {
      const { service, prisma } = build();

      await service.getDashboardSummary('o-1');

      // The dashboard tile predicate...
      expect(prisma.message.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          senderType: 'CUSTOMER',
          readAt: null,
        }),
      });

      // ...is the same one the per-row count uses.
      await service.getAssignedCustomers(officer, { page: 1, pageSize: 20 });
      expect(prisma.message.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            senderType: 'CUSTOMER',
            readAt: null,
          }),
          _count: { _all: true },
        }),
      );
    });

    it('scopes the dashboard to the same portfolio as the list', async () => {
      // A tile that counted only primary assignments would disagree with the
      // list it drills into, which is the whole point of the tiles being
      // clickable.
      const { service, prisma } = build();

      await service.getDashboardSummary('o-1');
      const dashboardWhere = prisma.customer.findMany.mock.calls[0][0].where;

      await service.getAssignedCustomers(officer, { page: 1, pageSize: 20 });
      const listWhere = prisma.customer.findMany.mock.calls[1][0].where;

      expect(dashboardWhere).toEqual({
        OR: [
          { assignedOfficerId: 'o-1' },
          { officerAssignments: { some: { staffId: 'o-1' } } },
        ],
      });
      expect(listWhere.AND[0]).toEqual(dashboardWhere);
    });

    it('sorts by who has been waiting longest', async () => {
      const { service } = build({
        customer: {
          count: jest.fn().mockResolvedValue(2),
          findMany: jest
            .fn()
            .mockResolvedValue([customerRow('1', 'A'), customerRow('2', 'B')]),
          findFirst: jest.fn(),
        },
        message: {
          groupBy: jest
            .fn()
            .mockResolvedValueOnce([
              {
                customerId: '1',
                _max: { createdAt: new Date('2026-08-22T07:41:00.000Z') },
              },
              {
                customerId: '2',
                _max: { createdAt: new Date('2026-08-20T07:41:00.000Z') },
              },
            ])
            .mockResolvedValueOnce([]),
          count: jest.fn(),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
        sortBy: 'lastMessageAt',
        sortOrder: 'asc',
      });

      // Oldest unanswered message first.
      expect(res.data.map((c) => c.id)).toEqual(['2', '1']);
    });
  });

  describe('AO-P2 - stock balance per row', () => {
    it('returns cartons paid for but not yet loaded', async () => {
      const { service } = build({
        $queryRaw: jest.fn().mockResolvedValue([{ customerId: '1', qty: 500 }]),
        loadingRequest: {
          groupBy: jest
            .fn()
            .mockResolvedValue([
              { customerId: '1', _sum: { quantityCartons: 260 } },
            ]),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0].stockBalanceCartons).toBe(240);
    });

    it('floors at zero rather than going negative', async () => {
      const { service } = build({
        $queryRaw: jest.fn().mockResolvedValue([{ customerId: '1', qty: 10 }]),
        loadingRequest: {
          groupBy: jest
            .fn()
            .mockResolvedValue([
              { customerId: '1', _sum: { quantityCartons: 99 } },
            ]),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0].stockBalanceCartons).toBe(0);
    });

    it('counts only COMPLETED loading requests, as the admin list does', async () => {
      const { service, prisma } = build();

      await service.getAssignedCustomers(officer, { page: 1, pageSize: 20 });

      expect(prisma.loadingRequest.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: { in: ['1'] }, status: 'COMPLETED' },
        }),
      );
    });
  });

  describe('AO-P1 - the envelope', () => {
    it('returns { data, meta } with the full standard meta block', async () => {
      const { service } = build({
        customer: {
          count: jest.fn().mockResolvedValue(24),
          findMany: jest.fn().mockResolvedValue([customerRow('1', 'ADLAK')]),
          findFirst: jest.fn(),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.meta).toEqual({
        total: 24,
        page: 1,
        pageSize: 20,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('echoes pageSize as APPLIED, clamped rather than rejected', async () => {
      const { service } = build();

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 5000,
      });

      expect(res.meta.pageSize).toBe(200);
    });

    it('applies search to name, account number and phone server-side', async () => {
      const { service, prisma } = build();

      await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
        search: 'adlak',
      });

      expect(prisma.customer.count.mock.calls[0][0].where.AND).toContainEqual({
        OR: [
          { name: { contains: 'adlak', mode: 'insensitive' } },
          { erpId: { contains: 'adlak', mode: 'insensitive' } },
          { phone: { contains: 'adlak', mode: 'insensitive' } },
        ],
      });
    });

    it('keeps a valid meta on an empty result, never a bare array', async () => {
      const { service } = build({
        customer: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
        },
      });

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data).toEqual([]);
      expect(res.meta).toMatchObject({ total: 0, totalPages: 1 });
    });
  });

  describe('AO-D1 - precision', () => {
    it('passes the wallet balance through unrounded', async () => {
      const { service } = build();

      const res = await service.getAssignedCustomers(officer, {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0].walletBalance).toBe(-10140600.1232);
    });
  });
});
