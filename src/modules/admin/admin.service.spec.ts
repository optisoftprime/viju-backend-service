import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { EmailService } from '../../infrastructure/email/email.types';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
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

    it('should throw NotFound if target officer does not exist', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: '1' });
      mockPrisma.staff.findFirst.mockResolvedValue(null);

      await expect(
        service.reassignOfficer('1', { newOfficerId: 'bad_officer_id' }),
      ).rejects.toThrow(NotFoundException);
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
  });

  describe('deactivateOfficer', () => {
    it('should throw BadRequest if officer still has assigned customers', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        customers: [{ id: 'c-1' }],
      });
      await expect(service.deactivateOfficer('o-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should deactivate the officer successfully if no customers', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({
        id: 'o-1',
        customers: [],
      });
      mockPrisma.staff.update.mockResolvedValue({ id: 'o-1', isActive: false });

      await service.deactivateOfficer('o-1');
      expect(mockPrisma.staff.update).toHaveBeenCalledWith({
        where: { id: 'o-1' },
        data: { isActive: false },
      });
    });
  });
});
