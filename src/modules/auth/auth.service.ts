import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  RequestOtpDto,
  VerifyOtpDto,
  CustomerLoginDto,
  StaffLoginDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async requestOtp(dto: RequestOtpDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { phone: dto.phone },
    });

    if (!customer) {
      throw new NotFoundException(
        'This number is not registered with Viju. Please contact your account officer.',
      );
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: {
        phone: dto.phone,
        code,
        expiresAt,
      },
    });

    console.log(`[SMS MOCK] Sent code ${code} to ${dto.phone}`);
    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const otpRec = await this.prisma.otpVerification.findFirst({
      where: { phone: dto.phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRec) throw new BadRequestException('No OTP found for this number');
    if (otpRec.lockedUntil && otpRec.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account locked due to too many attempts. Please try again later.',
      );
    }
    if (otpRec.expiresAt < new Date()) {
      throw new BadRequestException(
        'OTP has expired. Please request a new one.',
      );
    }

    if (otpRec.code !== dto.code) {
      await this.prisma.otpVerification.update({
        where: { id: otpRec.id },
        data: {
          attempts: otpRec.attempts + 1,
          lockedUntil:
            otpRec.attempts + 1 >= 3
              ? new Date(Date.now() + 30 * 60 * 1000)
              : null,
        },
      });
      throw new UnauthorizedException('Invalid OTP code');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { phone: dto.phone },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { password: hashedPassword },
    });

    await this.prisma.otpVerification.deleteMany({
      where: { phone: dto.phone },
    });

    return this.generateToken(customer, 'CUSTOMER');
  }

  async customerLogin(dto: CustomerLoginDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { phone: dto.phone },
    });

    if (!customer || !customer.password)
      throw new UnauthorizedException('Incorrect password. Please try again.');

    const isMatch = await bcrypt.compare(dto.password, customer.password);
    if (!isMatch)
      throw new UnauthorizedException('Incorrect password. Please try again.');

    return this.generateToken(customer, 'CUSTOMER');
  }

  async staffLogin(dto: StaffLoginDto) {
    const staff = await this.prisma.staff.findFirst({
      where: { email: dto.email },
    });

    if (!staff || !staff.password)
      throw new UnauthorizedException('Incorrect credentials.');

    const isMatch = await bcrypt.compare(dto.password, staff.password);
    if (!isMatch) throw new UnauthorizedException('Incorrect credentials.');

    return this.generateToken(staff, 'STAFF');
  }

  private generateToken(user: any, entityType: 'CUSTOMER' | 'STAFF') {
    const payload = {
      sub: user.id,
      role: entityType === 'CUSTOMER' ? 'CUSTOMER' : user.role,
      type: entityType,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        role: payload.role,
      },
    };
  }
}
