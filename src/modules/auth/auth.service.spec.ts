import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

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
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mocked_jwt_token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
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
      await expect(service.customerLogin({ phone: '12345', password: 'password' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw Unauthorized if password is wrong', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: '1', phone: '12345', password: 'hashed' });
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(service.customerLogin({ phone: '12345', password: 'wrong_password' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should return token if login succeeds', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: '1', name: 'John Doe', role: 'CUSTOMER', phone: '12345', password: 'hashed' });
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const result = await service.customerLogin({ phone: '12345', password: 'correct_password' });
      
      expect(result.access_token).toBe('mocked_jwt_token');
      expect(result.user.name).toBe('John Doe');
      expect(mockJwt.sign).toHaveBeenCalledWith({ sub: '1', role: 'CUSTOMER', type: 'CUSTOMER' });
    });
  });
});
