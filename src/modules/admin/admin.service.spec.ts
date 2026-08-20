import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { EmailService } from '../../infrastructure/email/email.types';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

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
    },
    staff: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    // Reassignment moves Customer.assignedOfficerId and the CustomerOfficer
    // join row together (US-13.5), so it runs in a transaction. The mock hands
    // the callback the same client the service would otherwise use.
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockNotifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const mockEmail = { send: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: EmailService, useValue: mockEmail },
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
        role: 'OFFICER',
      });
      mockPrisma.customer.update.mockResolvedValue({
        id: '1',
        assignedOfficerId: 'o-1',
      });

      const result = await service.reassignOfficer('1', {
        newOfficerId: 'o-1',
      });
      expect(result.assignedOfficerId).toBe('o-1');
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { assignedOfficerId: 'o-1' },
      });
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

  describe('setOfficerActive', () => {
    it('refuses deactivation with 409 + count while customers remain (US-15.4)', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        isActive: true,
      });
      mockPrisma.customer.count.mockResolvedValue(14);

      await expect(service.setOfficerActive('o-1', false)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.setOfficerActive('o-1', false),
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
      await expect(service.setOfficerActive('nope', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates the officer when no customers remain', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        isActive: true,
      });
      mockPrisma.customer.count.mockResolvedValue(0);
      mockPrisma.staff.update.mockResolvedValue({ id: 'o-1', isActive: false });

      await service.setOfficerActive('o-1', false);
      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'o-1' },
          data: { isActive: false },
        }),
      );
    });

    it('reactivates without the customer check', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        isActive: false,
      });
      mockPrisma.staff.update.mockResolvedValue({ id: 'o-1', isActive: true });

      await service.setOfficerActive('o-1', true);
      expect(mockPrisma.customer.count).not.toHaveBeenCalled();
      expect(mockPrisma.staff.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: true } }),
      );
    });
  });
});
