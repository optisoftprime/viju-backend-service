import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { ErpService } from '../../infrastructure/erp/erp.types';
import { EmailService } from '../../infrastructure/email/email.types';
import { OtpService } from '../../infrastructure/otp/otp.service';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwt: JwtService;

  const mockPrisma = {
    customer: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    otpVerification: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'rt-1' }),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mocked_jwt_token'),
  };

  const mockSms = { send: jest.fn().mockResolvedValue(undefined) };
  const mockErp = {
    findCustomerByPhone: jest.fn(),
    getCustomerProfile: jest.fn(),
    getWalletBalance: jest.fn(),
    getStockBalance: jest.fn(),
    getInvoices: jest.fn(),
    getPurchases: jest.fn(),
    getPayments: jest.fn(),
    validateStaffCredentials: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: SmsService, useValue: mockSms },
        { provide: ErpService, useValue: mockErp },
        { provide: EmailService, useValue: { send: jest.fn() } },
        {
          provide: OtpService,
          useValue: { send: jest.fn(), verify: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwt = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('customerLogin', () => {
    it('should throw Unauthorized if customer is not found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      await expect(
        service.customerLogin({ phone: '12345', password: 'password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw Unauthorized if password is wrong', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: '1',
        phone: '12345',
        password: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.customerLogin({ phone: '12345', password: 'wrong_password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token if login succeeds', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: '1',
        name: 'John Doe',
        role: 'CUSTOMER',
        phone: '12345',
        password: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.customerLogin({
        phone: '12345',
        password: 'correct_password',
      });

      expect(result.access_token).toBe('mocked_jwt_token');
      expect(result.user.name).toBe('John Doe');
      expect(mockJwt.sign).toHaveBeenCalledWith({
        sub: '1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      });
    });
  });

  /**
   * PRD "Change in User Source": ADMIN, REGIONAL_ADMIN, OFFICER and
   * LOADING_OFFICER are owned by this service. The ERP must not create them,
   * must not authenticate them and must not overwrite their role, region or
   * account status. WAREHOUSE_OFFICER is still mirrored from the ERP.
   */
  describe('staffWebLogin', () => {
    // An internally managed user: an ADMIN created them through
    // POST /admin/officers, so they carry a local password and no ERP code.
    const managedStaff = {
      id: 'staff-1',
      role: 'OFFICER',
      name: 'James Okonkwo',
      email: 'jokonkwo@viju.example',
      phone: '+2348012345678',
      username: null,
      erpCode: null,
      password: 'hashed_password',
      isActive: true,
      region: 'LAGOS',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
    };

    // What the ERP would say about the same person: promoted to
    // REGIONAL_ADMIN and moved to NORTH. None of it may reach the database.
    const promotedCredential = {
      username: 'jokonkwo',
      erpCode: 'EMP-001',
      name: 'James Okonkwo',
      email: 'jokonkwo@viju.example',
      phone: '+2348012345678',
      role: 'REGIONAL_ADMIN' as const,
      bpClusterCode: 5 as const, // NORTH
    };

    // A role the ERP still owns.
    const warehouseCredential = {
      ...promotedCredential,
      username: 'wkeeper',
      email: 'wkeeper@viju.example',
      role: 'WAREHOUSE_OFFICER' as const,
    };

    describe('internally managed users', () => {
      beforeEach(() => {
        mockPrisma.staff.findFirst.mockResolvedValue(managedStaff);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
        mockPrisma.staff.update.mockImplementation(({ data }) =>
          Promise.resolve({ ...managedStaff, ...data }),
        );
      });

      it('authenticates against the local password, never the ERP', async () => {
        const result = await service.staffWebLogin({
          username: 'jokonkwo@viju.example',
          code: 'TempPass123',
        });

        expect(mockErp.validateStaffCredentials).not.toHaveBeenCalled();
        expect(bcrypt.compare).toHaveBeenCalledWith(
          'TempPass123',
          'hashed_password',
        );
        expect(result.user).toEqual(
          expect.objectContaining({ role: 'OFFICER', region: 'LAGOS' }),
        );
      });

      it('writes nothing but the login stamp — the ERP owns none of it', async () => {
        await service.staffWebLogin({
          username: 'jokonkwo@viju.example',
          code: 'TempPass123',
        });

        const { data } = mockPrisma.staff.update.mock.calls[0][0];
        expect(Object.keys(data)).toEqual(['lastLoginAt']);
      });

      it('does not fall back to the ERP when the local password is wrong', async () => {
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        await expect(
          service.staffWebLogin({
            username: 'jokonkwo@viju.example',
            code: 'wrong',
          }),
        ).rejects.toThrow(UnauthorizedException);
        // A permissive ERP credential check must not become a way around the
        // local one.
        expect(mockErp.validateStaffCredentials).not.toHaveBeenCalled();
        expect(mockPrisma.staff.update).not.toHaveBeenCalled();
      });

      it('rejects a deactivated account without rewriting the row', async () => {
        mockPrisma.staff.findFirst.mockResolvedValue({
          ...managedStaff,
          isActive: false,
        });

        await expect(
          service.staffWebLogin({
            username: 'jokonkwo@viju.example',
            code: 'TempPass123',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.staff.update).not.toHaveBeenCalled();
      });

      it('points a passwordless legacy row at the reset flow', async () => {
        mockPrisma.staff.findFirst.mockResolvedValue({
          ...managedStaff,
          password: null,
        });

        await expect(
          service.staffWebLogin({
            username: 'jokonkwo@viju.example',
            code: 'EMP-001',
          }),
        ).rejects.toThrow(UnauthorizedException);
        expect(mockErp.validateStaffCredentials).not.toHaveBeenCalled();
      });
    });

    describe('ERP-mirrored users', () => {
      it('refuses to provision a managed role from the ERP', async () => {
        mockPrisma.staff.findFirst.mockResolvedValue(null);
        mockPrisma.staff.findUnique.mockResolvedValue(null);
        mockErp.validateStaffCredentials.mockResolvedValue(promotedCredential);

        await expect(
          service.staffWebLogin({ username: 'jokonkwo', code: 'EMP-001' }),
        ).rejects.toThrow(UnauthorizedException);
        expect(mockPrisma.staff.create).not.toHaveBeenCalled();
        expect(mockPrisma.staff.upsert).not.toHaveBeenCalled();
      });

      it('refuses to authenticate a managed row reached via the ERP email', async () => {
        // Nothing matches the submitted username, but the email the ERP
        // reports belongs to an internally managed account.
        mockPrisma.staff.findFirst.mockResolvedValue(null);
        mockPrisma.staff.findUnique.mockResolvedValue(managedStaff);
        mockErp.validateStaffCredentials.mockResolvedValue(warehouseCredential);

        await expect(
          service.staffWebLogin({ username: 'wkeeper', code: 'EMP-001' }),
        ).rejects.toThrow(UnauthorizedException);
        expect(mockPrisma.staff.update).not.toHaveBeenCalled();
      });

      it('still mirrors a WAREHOUSE_OFFICER on every login', async () => {
        const warehouseStaff = {
          ...managedStaff,
          id: 'staff-2',
          role: 'WAREHOUSE_OFFICER',
          username: 'wkeeper',
          email: 'wkeeper@viju.example',
          password: null,
        };
        mockPrisma.staff.findFirst.mockResolvedValue(warehouseStaff);
        mockErp.validateStaffCredentials.mockResolvedValue(warehouseCredential);
        mockPrisma.staff.update.mockImplementation(({ data }) =>
          Promise.resolve({ ...warehouseStaff, ...data }),
        );

        await service.staffWebLogin({ username: 'wkeeper', code: 'EMP-001' });

        expect(mockPrisma.staff.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'staff-2' },
            data: expect.objectContaining({
              role: 'WAREHOUSE_OFFICER',
              region: 'NORTH',
            }),
          }),
        );
      });

      it('never writes the portal-owned columns', async () => {
        const warehouseStaff = {
          ...managedStaff,
          id: 'staff-2',
          role: 'WAREHOUSE_OFFICER',
          username: 'wkeeper',
          email: 'wkeeper@viju.example',
        };
        mockPrisma.staff.findFirst.mockResolvedValue(warehouseStaff);
        mockErp.validateStaffCredentials.mockResolvedValue(warehouseCredential);
        mockPrisma.staff.update.mockImplementation(({ data }) =>
          Promise.resolve({ ...warehouseStaff, ...data }),
        );

        await service.staffWebLogin({ username: 'wkeeper', code: 'EMP-001' });

        // US-15.5: an ERP sync must not reactivate an account an admin
        // deactivated, nor clear a locally-set password or a lockout.
        const { data } = mockPrisma.staff.update.mock.calls[0][0];
        expect(data).not.toHaveProperty('isActive');
        expect(data).not.toHaveProperty('password');
        expect(data).not.toHaveProperty('failedLoginAttempts');
        expect(data).not.toHaveProperty('lockedUntil');
      });

      it('still applies role and region when a unique field collides', async () => {
        const warehouseStaff = {
          ...managedStaff,
          id: 'staff-2',
          role: 'WAREHOUSE_OFFICER',
          username: 'wkeeper',
          email: 'wkeeper@viju.example',
        };
        mockPrisma.staff.findFirst.mockResolvedValue(warehouseStaff);
        mockErp.validateStaffCredentials.mockResolvedValue(warehouseCredential);

        const conflict = new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: 'test', meta: { target: ['phone'] } },
        );
        mockPrisma.staff.update
          .mockRejectedValueOnce(conflict)
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...warehouseStaff, ...data }),
          );

        const result = await service.staffWebLogin({
          username: 'wkeeper',
          code: 'EMP-001',
        });

        // A duplicate phone in the ERP feed must not lock the user out: the
        // retry drops the unique columns and keeps role/region.
        const retry = mockPrisma.staff.update.mock.calls[1][0];
        expect(retry.data).toEqual(
          expect.objectContaining({
            role: 'WAREHOUSE_OFFICER',
            region: 'NORTH',
          }),
        );
        expect(retry.data).not.toHaveProperty('phone');
        expect(retry.data).not.toHaveProperty('email');
        expect(retry.data).not.toHaveProperty('username');
        expect(result.user.role).toBe('WAREHOUSE_OFFICER');
      });

      it('rejects credentials the ERP does not recognise', async () => {
        mockPrisma.staff.findFirst.mockResolvedValue(null);
        mockErp.validateStaffCredentials.mockResolvedValue(null);

        await expect(
          service.staffWebLogin({ username: 'nobody', code: 'x' }),
        ).rejects.toThrow(UnauthorizedException);
        expect(mockPrisma.staff.create).not.toHaveBeenCalled();
      });
    });
  });
});
