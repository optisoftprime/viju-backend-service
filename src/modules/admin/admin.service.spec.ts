import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { EmailService } from '../../infrastructure/email/email.types';
import { ErpRawService } from '../../infrastructure/erp-raw/erp-raw.service';
import { DefaultOfficerService } from '../erp/default-officer.service';
import { ErpAccountBalanceService } from '../erp/erp-account-balance.service';
import { ErpStockBalanceService } from '../erp/erp-stock-balance.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    customerOfficer: {
      deleteMany: jest.fn(),
      upsert: jest.fn(),
      // AD-R1 - PATCH /admin/customers/:id/reassign returns the resulting
      // assignments so the OFFICERS cell refreshes without a refetch.
      findMany: jest.fn().mockResolvedValue([]),
    },
    staff: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      // Status changes go through a CONDITIONAL updateMany so two concurrent
      // requests cannot both claim the transition.
      updateMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    // Reassignment moves Customer.assignedOfficerId and the CustomerOfficer
    // join row together (US-13.5), so it runs in a transaction. The mock hands
    // the callback the same client the service would otherwise use.
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockNotifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const mockEmail = { send: jest.fn().mockResolvedValue(undefined) };

  // The ERP landing schema is optional; these tests run without it, which is
  // the same shape a database with no feed attached returns.
  const mockErpRaw = {
    isAvailable: jest.fn().mockResolvedValue(false),
    getLastSeenByErpIds: jest.fn().mockResolvedValue(new Map()),
    getPhonesByErpIds: jest.fn().mockResolvedValue(new Map()),
    getCustomerCounts: jest.fn().mockResolvedValue({
      erpTotal: 0,
      vijuTotal: 0,
      unmappedRegionCount: 0,
      byRegion: {},
      lastSyncAt: null,
    }),
    getSyncStatus: jest.fn().mockResolvedValue({ lastSyncAt: null, jobs: [] }),
    getCustomerDetail: jest.fn().mockResolvedValue(null),
    listUnmappedCustomers: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    countUnprojectedCustomers: jest.fn().mockResolvedValue(0),
    listUnprojectedCustomers: jest.fn().mockResolvedValue([]),
  };

  // Customers with no officer are parked on the default one (james.o) by
  // DefaultOfficerService. These tests assert the ADMIN paths, so it is stubbed
  // to "no default officer configured" — the branch that changes nothing.
  // The ERP credit feed is absent in tests, which is the documented fallback
  // path: balances come from the stored column.
  const mockAccountBalance = {
    getRunningBalances: jest.fn().mockResolvedValue(new Map()),
    getRunningBalance: jest.fn().mockResolvedValue(null),
  };

  const mockDefaultOfficer = {
    resolveOfficerId: jest.fn().mockResolvedValue(null),
    assignIfUnassigned: jest.fn().mockResolvedValue(null),
    reconcile: jest.fn().mockResolvedValue({
      available: false,
      skipped: false,
      assigned: 0,
      officerEmail: 'james.o@viju.example',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: EmailService, useValue: mockEmail },
        { provide: ErpRawService, useValue: mockErpRaw },
        { provide: DefaultOfficerService, useValue: mockDefaultOfficer },
        { provide: ErpAccountBalanceService, useValue: mockAccountBalance },
        {
          provide: ErpStockBalanceService,
          // The STOCK column's ERP source. These specs assert other columns,
          // so it answers "nothing known" and the local fallback stands.
          useValue: {
            stockByErpId: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  /**
   * FE request 3.2 A — the customer list can serve ERP rows the projector has
   * not copied across yet, so the dashboard tile and the table agree.
   */
  describe('getAllCustomers — includeUnprojected', () => {
    const projectedRow = (erpId: string) => ({
      id: `id-${erpId}`,
      erpId,
      name: `Customer ${erpId}`,
      phone: '+2348000000000',
      region: 'LAGOS',
      accountStatus: 'ACTIVE',
      outstandingBalance: 0,
      assignedOfficerId: null,
      createdAt: new Date('2026-01-01'),
      _count: { supportTickets: 0 },
      officerAssignments: [],
    });

    const erpRow = (erpId: string) => ({
      erpId,
      name: `ERP ${erpId}`,
      phone: '0800000000',
      region: 'LAGOS' as const,
      lastSeenAt: new Date('2026-08-17'),
    });

    beforeEach(() => {
      // withErpColumns() needs these two aggregates for any non-empty page.
      (mockPrisma as Record<string, unknown>).$queryRaw = jest
        .fn()
        .mockResolvedValue([]);
      (mockPrisma as Record<string, unknown>).loadingRequest = {
        groupBy: jest.fn().mockResolvedValue([]),
      };
    });

    it('leaves the default mode untouched — no ERP call, no extra meta', async () => {
      mockPrisma.customer.count.mockResolvedValue(4);
      mockPrisma.customer.findMany.mockResolvedValue([projectedRow('A')]);

      const res = await service.getAllCustomers({}, { page: 1, pageSize: 20 });

      expect(mockErpRaw.countUnprojectedCustomers).not.toHaveBeenCalled();
      expect(res.meta.total).toBe(4);
      expect(res.meta).not.toHaveProperty('projectedTotal');
      expect(res.data[0]).toMatchObject({ erpId: 'A', isProjected: true });
    });

    it('reports the union size so the tile and the list agree', async () => {
      mockPrisma.customer.count.mockResolvedValue(4);
      mockPrisma.customer.findMany.mockResolvedValue([projectedRow('A')]);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(1847);

      const res = await service.getAllCustomers(
        { includeUnprojected: true },
        { page: 1, pageSize: 20 },
      );

      expect(res.meta.total).toBe(1851);
      expect(res.meta.projectedTotal).toBe(4);
      expect(res.meta.unprojectedTotal).toBe(1847);
      expect(res.meta.totalPages).toBe(93);
    });

    it('splits a page that straddles the boundary', async () => {
      mockPrisma.customer.count.mockResolvedValue(4);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(1847);
      mockPrisma.customer.findMany.mockResolvedValue([projectedRow('D')]);
      mockErpRaw.listUnprojectedCustomers.mockResolvedValue([
        erpRow('E'),
        erpRow('F'),
      ]);

      // page 2 of size 3 starts at offset 3: one projected row left, then two
      // from the ERP side starting at its own offset 0.
      const res = await service.getAllCustomers(
        { includeUnprojected: true },
        { page: 2, pageSize: 3 },
      );

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 3, take: 1 }),
      );
      expect(mockErpRaw.listUnprojectedCustomers).toHaveBeenCalledWith(
        expect.anything(),
        { skip: 0, take: 2 },
      );
      expect(res.data.map((r) => r.erpId)).toEqual(['D', 'E', 'F']);
      expect(res.data.map((r) => r.isProjected)).toEqual([true, false, false]);
    });

    it('offsets into the ERP side once the projected rows are exhausted', async () => {
      mockPrisma.customer.count.mockResolvedValue(4);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(1847);
      mockErpRaw.listUnprojectedCustomers.mockResolvedValue([erpRow('Z')]);

      await service.getAllCustomers(
        { includeUnprojected: true },
        { page: 3, pageSize: 3 },
      );

      // offset 6 - 4 projected = 2 into the ERP set; no projected query at all.
      expect(mockErpRaw.listUnprojectedCustomers).toHaveBeenCalledWith(
        expect.anything(),
        { skip: 2, take: 3 },
      );
      expect(mockPrisma.customer.findMany).not.toHaveBeenCalled();
    });

    it('returns explicit nulls for fields the ERP master does not carry', async () => {
      mockPrisma.customer.count.mockResolvedValue(0);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(1);
      mockErpRaw.listUnprojectedCustomers.mockResolvedValue([erpRow('N')]);

      const res = await service.getAllCustomers(
        { includeUnprojected: true },
        { page: 1, pageSize: 20 },
      );

      expect(res.data[0]).toMatchObject({
        id: null,
        erpId: 'N',
        region: 'LAGOS',
        accountStatus: null,
        outstandingBalance: null,
        stockBalanceCartons: null,
        createdAt: null,
        hasOfficer: false,
        officerAssignments: [],
        isProjected: false,
      });
    });

    it('excludes the ERP side when filtering on hasOfficer=true', async () => {
      mockPrisma.customer.count.mockResolvedValue(2);
      mockPrisma.customer.findMany.mockResolvedValue([projectedRow('A')]);

      const res = await service.getAllCustomers(
        { includeUnprojected: true, hasOfficer: true },
        { page: 1, pageSize: 20 },
      );

      // An unprojected row has no local record, so it can never have an
      // officer — counting it would inflate the total with unreachable rows.
      expect(mockErpRaw.countUnprojectedCustomers).not.toHaveBeenCalled();
      expect(res.meta.unprojectedTotal).toBe(0);
      expect(res.meta.total).toBe(2);
    });

    it('passes region and search through to the ERP side', async () => {
      mockPrisma.customer.count.mockResolvedValue(0);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(5);
      mockErpRaw.listUnprojectedCustomers.mockResolvedValue([]);

      await service.getAllCustomers(
        { includeUnprojected: true, region: 'LAGOS' as never, search: 'LAT' },
        { page: 1, pageSize: 20 },
      );

      expect(mockErpRaw.countUnprojectedCustomers).toHaveBeenCalledWith({
        region: 'LAGOS',
        search: 'LAT',
      });
    });

    it('applies search to BOTH halves of the union and counts the filtered set (AD-S1)', async () => {
      // The All Customers modal searches in union mode so `meta.total` can
      // match the dashboard tile. Dropping `search` on either half would
      // return unrelated rows under an unfiltered total (the 1851 bug).
      mockPrisma.customer.count.mockResolvedValue(0);
      mockErpRaw.countUnprojectedCustomers.mockResolvedValue(1);
      mockErpRaw.listUnprojectedCustomers.mockResolvedValue([
        erpRow('10110044'),
      ]);

      const res = await service.getAllCustomers(
        { includeUnprojected: true, search: 'latlek' },
        { page: 1, pageSize: 20 },
      );

      // Projected half: name OR erpId, case-insensitive.
      expect(mockPrisma.customer.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: [
            { name: { contains: 'latlek', mode: 'insensitive' } },
            { erpId: { contains: 'latlek', mode: 'insensitive' } },
          ],
        }),
      });
      // Unprojected half: the same term reaches the ERP-feed query.
      expect(mockErpRaw.countUnprojectedCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'latlek' }),
      );
      expect(mockErpRaw.listUnprojectedCustomers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'latlek' }),
        expect.anything(),
      );
      // meta.total is the size of the FILTERED union, so paging stays
      // arithmetically correct.
      expect(res.meta.total).toBe(1);
      expect(res.meta.projectedTotal).toBe(0);
      expect(res.meta.unprojectedTotal).toBe(1);
      expect(res.meta.totalPages).toBe(1);
    });
  });

  describe('reassignOfficer', () => {
    it('should throw NotFound if customer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.reassignOfficer('bad_customer_id', { newOfficerId: '2' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequest if target officer is not active or not in customer region', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        region: 'LAGOS',
      });
      mockPrisma.staff.findFirst.mockResolvedValue(null);

      await expect(
        service.reassignOfficer('1', { newOfficerId: 'bad_officer_id' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should cleanly update the DB and resolve if validation passes', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: '1' });
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 'o-1',
        name: 'Ifeanyi Okon',
        role: 'OFFICER',
      });
      mockPrisma.customer.update.mockResolvedValue({
        id: '1',
        assignedOfficerId: 'o-1',
      });
      mockPrisma.customerOfficer.findMany.mockResolvedValue([
        {
          id: 'as-1',
          isPrimary: true,
          assignedAt: new Date('2026-08-22T09:10:00.000Z'),
          staff: { id: 'o-1', name: 'Ifeanyi Okon', email: 'i.okon@viju.com' },
        },
      ]);

      const result = await service.reassignOfficer('1', {
        newOfficerId: 'o-1',
      });
      // AD-R1 - the body names the customer and carries the resulting
      // assignments, so the OFFICERS cell updates without a refetch.
      expect(result).toMatchObject({
        message: 'Customer assigned successfully',
        customerId: '1',
      });
      expect(result.officerAssignments[0].staff.id).toBe('o-1');
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { assignedOfficerId: 'o-1' },
      });
    });

    it('assigns a customer who has no officer yet (AD-R1)', async () => {
      // Empty officerAssignments[] and a null pointer - the first-assignment
      // case the Customers page hits, which must not need a source officer.
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        name: 'ADLAK',
        region: 'LAGOS',
        assignedOfficerId: null,
      });
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 'o-1',
        name: 'Ifeanyi Okon',
        role: 'OFFICER',
      });
      mockPrisma.customer.update.mockResolvedValue({
        id: '1',
        assignedOfficerId: 'o-1',
      });
      mockPrisma.customerOfficer.findMany.mockResolvedValue([]);

      await service.reassignOfficer('1', { newOfficerId: 'o-1' });

      // Nothing to detach; the join row is created outright.
      expect(mockPrisma.customerOfficer.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.customerOfficer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { customerId: '1', staffId: 'o-1', isPrimary: true },
        }),
      );
      // The incoming officer is notified on a FIRST assignment too. notify()
      // writes the bell row and dispatches the web push.
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'STAFF',
          recipientId: 'o-1',
          type: 'ASSIGNMENT',
        }),
      );
    });

    it('refuses a no-op reassignment with ALREADY_ASSIGNED (AD-R1)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        name: 'ADLAK',
        region: 'LAGOS',
        assignedOfficerId: 'o-1',
      });
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 'o-1',
        name: 'Ifeanyi Okon',
        role: 'OFFICER',
      });

      await expect(
        service.reassignOfficer('1', { newOfficerId: 'o-1' }),
      ).rejects.toMatchObject({
        response: {
          code: 'ALREADY_ASSIGNED',
          message: 'Ifeanyi Okon is already assigned to this customer',
        },
      });
    });

    it('addresses the row to the INCOMING officer only (N-4)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        name: 'Ade Foods Ltd',
        region: 'LAGOS',
        assignedOfficerId: 'o-old',
      });
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 'o-new',
        name: 'Ifeanyi Okon',
        role: 'OFFICER',
      });
      mockPrisma.customer.update.mockResolvedValue({ id: '1' });
      mockPrisma.customerOfficer.findMany.mockResolvedValue([]);

      await service.reassignOfficer('1', { newOfficerId: 'o-new' });

      // Exactly one row: not the outgoing officer, not the acting admin, not
      // the regional admin. `content` is "<title>: <body>".
      expect(mockNotifications.notify).toHaveBeenCalledTimes(1);
      expect(mockNotifications.notify).toHaveBeenCalledWith({
        recipientType: 'STAFF',
        recipientId: 'o-new',
        subjectCustomerId: '1',
        title: 'Customer assigned',
        body: 'Ade Foods Ltd has been assigned to you',
        type: 'ASSIGNMENT',
        data: { customerId: '1' },
      });
    });

    it('carries a machine-readable code on both not-found branches (AD-R1)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);
      await expect(
        service.reassignOfficer('nope', { newOfficerId: 'o-1' }),
      ).rejects.toMatchObject({ response: { code: 'CUSTOMER_NOT_FOUND' } });

      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        region: 'LAGOS',
      });
      mockPrisma.staff.findFirst.mockResolvedValue(null);
      await expect(
        service.reassignOfficer('1', { newOfficerId: 'nope' }),
      ).rejects.toMatchObject({ response: { code: 'OFFICER_NOT_FOUND' } });
    });

    it('repoints the CustomerOfficer join so chat and tickets follow (US-13.5)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        region: 'LAGOS',
        assignedOfficerId: 'o-old',
      });
      mockPrisma.staff.findFirst.mockResolvedValue({
        id: 'o-1',
        role: 'OFFICER',
      });
      mockPrisma.customer.update.mockResolvedValue({
        id: '1',
        assignedOfficerId: 'o-1',
      });

      await service.reassignOfficer('1', { newOfficerId: 'o-1' });

      expect(mockPrisma.customerOfficer.deleteMany).toHaveBeenCalledWith({
        where: { customerId: '1', staffId: 'o-old', isPrimary: true },
      });
      expect(mockPrisma.customerOfficer.upsert).toHaveBeenCalledWith({
        where: { customerId_staffId: { customerId: '1', staffId: 'o-1' } },
        update: { isPrimary: true },
        create: { customerId: '1', staffId: 'o-1', isPrimary: true },
      });
    });

    it('notifies the receiving officer (US-13.4)', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: '1',
        name: 'Ade Foods Ltd',
        region: 'LAGOS',
        assignedOfficerId: null,
      });
      mockPrisma.staff.findFirst.mockResolvedValue({ id: 'o-1' });
      mockPrisma.customer.update.mockResolvedValue({ id: '1' });

      await service.reassignOfficer('1', { newOfficerId: 'o-1' });

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'STAFF',
          recipientId: 'o-1',
          type: 'ASSIGNMENT',
        }),
      );
    });
  });

  // ─── Internally managed users (PRD "Change in User Source") ──────────────
  //
  // ADMIN, REGIONAL_ADMIN, OFFICER and LOADING_OFFICER are created,
  // deactivated and reactivated here and nowhere else — the ERP no longer
  // owns their lifecycle.
  describe('getOfficerDetail — regional admin scoping', () => {
    const officer = (over: Record<string, unknown>) => ({
      id: 'o-1',
      name: 'Ifeanyi Okon',
      role: 'OFFICER',
      region: 'LAGOS',
      isActive: true,
      ...over,
    });

    beforeEach(() => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.supportTicket = { count: jest.fn().mockResolvedValue(0) };
      mockPrisma.message = { groupBy: jest.fn().mockResolvedValue([]) };
    });

    it('lets a regional admin open an officer in their own region', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(officer({}));

      const detail = await service.getOfficerDetail('o-1', {
        role: 'REGIONAL_ADMIN',
        region: 'LAGOS' as never,
      });

      expect(detail.isManaged).toBe(true);
    });

    it('refuses an officer in another region', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(
        officer({ region: 'NORTH' }),
      );

      await expect(
        service.getOfficerDetail('o-1', {
          role: 'REGIONAL_ADMIN',
          region: 'LAGOS' as never,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each(['ADMIN', 'REGIONAL_ADMIN', 'WAREHOUSE_OFFICER'])(
      'refuses a regional admin reading a %s, region match or not',
      async (role) => {
        // A REGIONAL_ADMIN has no user-management privileges, so an
        // administrative account is not theirs to inspect even when the
        // regions line up (or are both null).
        mockPrisma.staff.findUnique.mockResolvedValue(
          officer({ role, region: null }),
        );

        await expect(
          service.getOfficerDetail('o-1', {
            role: 'REGIONAL_ADMIN',
            region: null,
          }),
        ).rejects.toThrow(ForbiddenException);
      },
    );

    it('lets an ADMIN read any of them', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(
        officer({ role: 'ADMIN', region: null }),
      );

      const detail = await service.getOfficerDetail('o-1', {
        role: 'ADMIN',
        region: null,
      });

      expect(detail.id).toBe('o-1');
    });
  });

  describe('createOfficer', () => {
    const admin = { id: 'admin-1' };

    const validDto = {
      name: 'Ifeanyi Okon',
      email: 'i.okon@viju.com',
      phone: '+2348012345678',
      region: 'LAGOS' as never,
      password: 'TempPass123',
    };

    beforeEach(() => {
      mockPrisma.staff.findFirst.mockResolvedValue(null);
      mockPrisma.staff.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new-1', ...data }),
      );
    });

    it('defaults to OFFICER and records the creating admin', async () => {
      const created = await service.createOfficer(validDto, admin);

      expect(mockPrisma.staff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'OFFICER',
            email: 'i.okon@viju.com',
            region: 'LAGOS',
            createdById: 'admin-1',
          }),
        }),
      );
      // The plaintext password is never stored.
      const { data } = mockPrisma.staff.create.mock.calls[0][0];
      expect(data.password).not.toBe('TempPass123');
      expect(created.emailSent).toBe(true);
    });

    it.each([
      ['ADMIN', undefined],
      ['REGIONAL_ADMIN', 'LAGOS'],
      ['OFFICER', 'LAGOS'],
      ['LOADING_OFFICER', 'LAGOS'],
    ])('creates a %s', async (role, region) => {
      await service.createOfficer(
        { ...validDto, role, region: region as never },
        admin,
      );
      expect(mockPrisma.staff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role }),
        }),
      );
    });

    it('accepts ACCOUNT_OFFICER as an alias for OFFICER', async () => {
      await service.createOfficer(
        { ...validDto, role: 'ACCOUNT_OFFICER' },
        admin,
      );
      expect(mockPrisma.staff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'OFFICER' }),
        }),
      );
    });

    it.each(['WAREHOUSE_OFFICER', 'SUPER_ADMIN', '', 'officer'])(
      'refuses the unsupported role %p even if it reaches the service',
      async (role) => {
        await expect(
          service.createOfficer({ ...validDto, role }, admin),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.staff.create).not.toHaveBeenCalled();
      },
    );

    it('requires a region for a region-scoped role', async () => {
      await expect(
        service.createOfficer(
          { ...validDto, role: 'LOADING_OFFICER', region: undefined },
          admin,
        ),
      ).rejects.toMatchObject({ response: { code: 'REGION_REQUIRED' } });
    });

    it('refuses a region on an organisation-wide ADMIN', async () => {
      await expect(
        service.createOfficer({ ...validDto, role: 'ADMIN' }, admin),
      ).rejects.toMatchObject({ response: { code: 'REGION_NOT_ALLOWED' } });
    });

    it.each([
      ['name', { name: '' }],
      ['email', { email: undefined }],
      ['phone', { phone: null }],
      ['password', { password: '' }],
    ])('refuses a missing/empty %s', async (_field, override) => {
      await expect(
        service.createOfficer({ ...validDto, ...(override as object) }, admin),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.staff.create).not.toHaveBeenCalled();
    });

    it('refuses a duplicate email regardless of case', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue({
        email: 'I.Okon@Viju.com',
        phone: '+2340000000000',
      });

      await expect(
        service.createOfficer(validDto, admin),
      ).rejects.toMatchObject({
        response: { message: 'Email already in use', code: 'EMAIL_IN_USE' },
      });
    });

    it('refuses a duplicate phone', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue({
        email: 'someone.else@viju.com',
        phone: '+2348012345678',
      });

      await expect(
        service.createOfficer(validDto, admin),
      ).rejects.toMatchObject({
        response: {
          message: 'Phone number already in use',
          code: 'PHONE_IN_USE',
        },
      });
    });

    it('maps a racing unique-constraint failure onto the same 400', async () => {
      // Two admins submitting the same email at once: the pre-flight check
      // passes for both, and the constraint is what actually refuses one.
      mockPrisma.staff.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'] },
        }),
      );

      await expect(
        service.createOfficer(validDto, admin),
      ).rejects.toMatchObject({
        response: { message: 'Email already in use', code: 'EMAIL_IN_USE' },
      });
    });

    it('still creates the account when the welcome email fails', async () => {
      mockEmail.send.mockRejectedValueOnce(new Error('smtp down'));

      const created = await service.createOfficer(validDto, admin);

      expect(mockPrisma.staff.create).toHaveBeenCalled();
      expect(created.emailSent).toBe(false);
    });
  });

  describe('setOfficerActive', () => {
    const admin = { id: 'admin-1' };

    beforeEach(() => {
      mockPrisma.staff.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    });

    it('refuses deactivation with 409 + count while customers remain (US-15.4)', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        role: 'OFFICER',
        isActive: true,
      });
      mockPrisma.customer.count.mockResolvedValue(14);

      await expect(
        service.setOfficerActive('o-1', false, admin),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.setOfficerActive('o-1', false, admin),
      ).rejects.toMatchObject({
        response: {
          code: 'OFFICER_HAS_CUSTOMERS',
          assignedCustomers: 14,
          statusCode: 409,
        },
      });
    });

    it('throws NotFound for an unknown officer', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      await expect(
        service.setOfficerActive('nope', false, admin),
      ).rejects.toThrow(NotFoundException);
    });

    it('deactivates the officer when no customers remain', async () => {
      mockPrisma.staff.findUnique
        .mockResolvedValueOnce({ id: 'o-1', role: 'OFFICER', isActive: true })
        .mockResolvedValueOnce({ id: 'o-1', isActive: false });
      mockPrisma.customer.count.mockResolvedValue(0);

      const result = await service.setOfficerActive('o-1', false, admin);

      expect(mockPrisma.staff.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // Conditional on the CURRENT status, so concurrent requests cannot
          // both write an audit stamp.
          where: { id: 'o-1', isActive: true },
          data: expect.objectContaining({
            isActive: false,
            deactivatedById: 'admin-1',
          }),
        }),
      );
      expect(result.changed).toBe(true);
    });

    it('revokes every live refresh token on deactivation (US-15.5)', async () => {
      mockPrisma.staff.findUnique
        .mockResolvedValueOnce({ id: 'o-1', role: 'OFFICER', isActive: true })
        .mockResolvedValueOnce({ id: 'o-1', isActive: false });
      mockPrisma.customer.count.mockResolvedValue(0);

      await service.setOfficerActive('o-1', false, admin);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { staffId: 'o-1', revokedAt: null },
        }),
      );
    });

    it('reactivates without the customer check, recording the admin', async () => {
      mockPrisma.staff.findUnique
        .mockResolvedValueOnce({ id: 'o-1', role: 'OFFICER', isActive: false })
        .mockResolvedValueOnce({ id: 'o-1', isActive: true });

      await service.setOfficerActive('o-1', true, admin);

      expect(mockPrisma.customer.count).not.toHaveBeenCalled();
      expect(mockPrisma.staff.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'o-1', isActive: false },
          data: expect.objectContaining({
            isActive: true,
            reactivatedById: 'admin-1',
          }),
        }),
      );
      // Nothing is deleted and no session is revoked on the way back in.
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent — a repeat/concurrent request reports changed: false', async () => {
      mockPrisma.staff.findUnique
        .mockResolvedValueOnce({ id: 'o-1', role: 'OFFICER', isActive: false })
        .mockResolvedValueOnce({ id: 'o-1', isActive: false });
      mockPrisma.customer.count.mockResolvedValue(0);
      // The conditional update matched nothing: someone else got there first.
      mockPrisma.staff.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.setOfficerActive('o-1', false, admin);

      expect(result.changed).toBe(false);
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to touch an ERP-owned role', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'w-1',
        role: 'WAREHOUSE_OFFICER',
        isActive: true,
      });

      await expect(
        service.setOfficerActive('w-1', false, admin),
      ).rejects.toMatchObject({ response: { code: 'ROLE_NOT_MANAGED' } });
      expect(mockPrisma.staff.updateMany).not.toHaveBeenCalled();
    });

    it('refuses self-deactivation', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        isActive: true,
      });

      await expect(
        service.setOfficerActive('admin-1', false, admin),
      ).rejects.toMatchObject({ response: { code: 'SELF_DEACTIVATION' } });
    });

    it('refuses to deactivate the last active admin', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'admin-2',
        role: 'ADMIN',
        isActive: true,
      });
      mockPrisma.staff.count.mockResolvedValue(1);

      await expect(
        service.setOfficerActive('admin-2', false, admin),
      ).rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_ADMIN' } });
      expect(mockPrisma.staff.updateMany).not.toHaveBeenCalled();
    });

    it('deactivates an admin while another one remains active', async () => {
      mockPrisma.staff.findUnique
        .mockResolvedValueOnce({ id: 'admin-2', role: 'ADMIN', isActive: true })
        .mockResolvedValueOnce({ id: 'admin-2', isActive: false });
      mockPrisma.staff.count.mockResolvedValue(2);

      const result = await service.setOfficerActive('admin-2', false, admin);

      // ADMIN holds no customer portfolio, so that check is skipped entirely.
      expect(mockPrisma.customer.count).not.toHaveBeenCalled();
      expect(result.changed).toBe(true);
    });
  });
});
