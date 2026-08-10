import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
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
});
