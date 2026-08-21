import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DefaultOfficerService } from './default-officer.service';
import {
  FALLBACK_DEFAULT_OFFICER_EMAIL,
  FALLBACK_DEFAULT_OFFICER_REGION,
  defaultAccountOfficerEmail,
  defaultAccountOfficerRegion,
  hasInvalidRegionOverride,
} from './default-officer';

describe('DefaultOfficerService', () => {
  let service: DefaultOfficerService;

  const mockPrisma = {
    staff: { findFirst: jest.fn() },
    customer: { updateMany: jest.fn() },
    customerOfficer: { upsert: jest.fn() },
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    // Both write paths run in a transaction so the pointer and the join row
    // land together. The mock hands the callback the same client.
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  const JAMES = { id: 'staff-james', region: 'LAGOS' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DefaultOfficerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(DefaultOfficerService);
    // The advisory lock is always ours unless a test says otherwise.
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ locked: true }]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DEFAULT_ACCOUNT_OFFICER_EMAIL;
    delete process.env.DEFAULT_ACCOUNT_OFFICER_REGION;
  });

  describe('defaultAccountOfficerEmail', () => {
    it('falls back to james.o when the variable is unset', () => {
      expect(defaultAccountOfficerEmail()).toBe(FALLBACK_DEFAULT_OFFICER_EMAIL);
      expect(FALLBACK_DEFAULT_OFFICER_EMAIL).toBe('james.o@viju.example');
    });

    it('treats a blank variable as unset rather than looking up ""', () => {
      process.env.DEFAULT_ACCOUNT_OFFICER_EMAIL = '   ';
      expect(defaultAccountOfficerEmail()).toBe(FALLBACK_DEFAULT_OFFICER_EMAIL);
    });

    it('normalises an override, since Staff.email is stored lower-case', () => {
      process.env.DEFAULT_ACCOUNT_OFFICER_EMAIL = '  Tunde@Viju.Example ';
      expect(defaultAccountOfficerEmail()).toBe('tunde@viju.example');
    });
  });

  describe('defaultAccountOfficerRegion', () => {
    it('is LAGOS by default — no other region is parked automatically', () => {
      expect(defaultAccountOfficerRegion()).toBe(
        FALLBACK_DEFAULT_OFFICER_REGION,
      );
      expect(FALLBACK_DEFAULT_OFFICER_REGION).toBe('LAGOS');
    });

    it('accepts a valid override, case-insensitively', () => {
      process.env.DEFAULT_ACCOUNT_OFFICER_REGION = ' north ';
      expect(defaultAccountOfficerRegion()).toBe('NORTH');
      expect(hasInvalidRegionOverride()).toBe(false);
    });

    it('falls back to LAGOS on a typo rather than widening the scope', () => {
      process.env.DEFAULT_ACCOUNT_OFFICER_REGION = 'LAGOSS';
      expect(defaultAccountOfficerRegion()).toBe('LAGOS');
      expect(hasInvalidRegionOverride()).toBe(true);
    });
  });

  describe('resolveOfficerId', () => {
    it('requires an ACTIVE OFFICER — parking on a disabled account would hide the customers', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      await service.resolveOfficerId();
      expect(mockPrisma.staff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: 'james.o@viju.example',
            role: 'OFFICER',
            isActive: true,
          },
        }),
      );
    });
  });

  describe('reconcile', () => {
    it('reports available:false and writes nothing when no such officer exists', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(null);

      const result = await service.reconcile();

      expect(result).toEqual({
        available: false,
        skipped: false,
        assigned: 0,
        officerEmail: 'james.o@viju.example',
        region: 'LAGOS',
      });
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('parks unassigned LAGOS customers and reports how many moved', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(412);

      const result = await service.reconcile();

      expect(result).toEqual({
        available: true,
        skipped: false,
        assigned: 412,
        officerEmail: 'james.o@viju.example',
        region: 'LAGOS',
      });
      // The region is part of the WHERE, and both values are bound rather than
      // interpolated into the SQL.
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('region = $2::"Region"'),
        'staff-james',
        'LAGOS',
      );
    });

    it('scopes to the configured region when it is overridden', async () => {
      process.env.DEFAULT_ACCOUNT_OFFICER_REGION = 'NORTH';
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(7);

      const result = await service.reconcile();

      expect(result.region).toBe('NORTH');
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        'staff-james',
        'NORTH',
      );
    });

    it('skips the pass when another instance holds the advisory lock', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ locked: false }]);

      const result = await service.reconcile();

      expect(result.skipped).toBe(true);
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  describe('assignIfUnassigned', () => {
    it('writes BOTH the primary pointer and the CustomerOfficer join row', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.assignIfUnassigned('cust-1');

      expect(result).toBe('staff-james');
      // Region is in the WHERE, so a non-LAGOS customer matches nothing.
      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', assignedOfficerId: null, region: 'LAGOS' },
        data: { assignedOfficerId: 'staff-james' },
      });
      // Without this the officer owns the customer but receives none of their
      // chat messages, tickets or notifications.
      expect(mockPrisma.customerOfficer.upsert).toHaveBeenCalledWith({
        where: {
          customerId_staffId: { customerId: 'cust-1', staffId: 'staff-james' },
        },
        update: { isPrimary: true },
        create: {
          customerId: 'cust-1',
          staffId: 'staff-james',
          isPrimary: true,
        },
      });
    });

    it('leaves a customer outside the region alone', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      // A WESTERN customer does not match the region in the WHERE.
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.assignIfUnassigned('cust-western')).toBeNull();
      expect(mockPrisma.customerOfficer.upsert).not.toHaveBeenCalled();
    });

    it('leaves a customer an admin already reassigned completely alone', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(JAMES);
      // The NULL check lives in the WHERE, so an already-assigned customer
      // matches nothing and the join row is never touched.
      mockPrisma.customer.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.assignIfUnassigned('cust-1');

      expect(result).toBeNull();
      expect(mockPrisma.customerOfficer.upsert).not.toHaveBeenCalled();
    });

    it('does nothing when no default officer is configured', async () => {
      mockPrisma.staff.findFirst.mockResolvedValue(null);

      expect(await service.assignIfUnassigned('cust-1')).toBeNull();
      expect(mockPrisma.customer.updateMany).not.toHaveBeenCalled();
    });
  });
});
