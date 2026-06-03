import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  RequestOtpDto,
  VerifyOtpDto,
  CustomerLoginDto,
  StaffLoginDto,
  StaffWebLoginDto,
  StaffPasswordResetRequestDto,
  StaffPasswordResetConfirmDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { ErpService } from '../../infrastructure/erp/erp.types';
import { StaffRole } from '@prisma/client';

const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_LOCK_MINUTES = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sms: SmsService,
    private readonly erp: ErpService,
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

    await this.sms.send({
      to: dto.phone,
      body: `Your Viju verification code is ${code}. It expires in 10 minutes.`,
    });
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

    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (customer.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new ForbiddenException(
        `Your account is locked. Try again in ${minutesLeft} minutes.`,
      );
    }

    const isMatch = await bcrypt.compare(dto.password, customer.password);
    if (!isMatch) {
      const nextAttempts = customer.failedLoginAttempts + 1;
      const willLock = nextAttempts >= PASSWORD_MAX_ATTEMPTS;
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          failedLoginAttempts: willLock ? 0 : nextAttempts,
          lockedUntil: willLock
            ? new Date(Date.now() + PASSWORD_LOCK_MINUTES * 60_000)
            : null,
        },
      });
      if (willLock) {
        throw new ForbiddenException(
          `Account locked for ${PASSWORD_LOCK_MINUTES} minutes due to too many failed attempts.`,
        );
      }
      throw new UnauthorizedException('Incorrect password. Please try again.');
    }

    if (customer.failedLoginAttempts > 0 || customer.lockedUntil) {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return this.generateToken(customer, 'CUSTOMER');
  }

  async staffWebLogin(dto: StaffWebLoginDto) {
    const erpStaff = await this.erp.validateStaffCredentials(
      dto.username,
      dto.code,
    );
    if (!erpStaff) {
      throw new UnauthorizedException('Invalid username or code.');
    }

    let staff = await this.prisma.staff.findUnique({
      where: { username: erpStaff.username },
    });

    if (!staff) {
      staff = await this.prisma.staff.upsert({
        where: { email: erpStaff.email },
        update: {
          username: erpStaff.username,
          erpCode: erpStaff.erpCode,
          phone: erpStaff.phone,
          role: erpStaff.role as StaffRole,
          region: erpStaff.region ?? null,
        },
        create: {
          name: erpStaff.name,
          email: erpStaff.email,
          phone: erpStaff.phone,
          username: erpStaff.username,
          erpCode: erpStaff.erpCode,
          role: erpStaff.role as StaffRole,
          region: erpStaff.region ?? null,
        },
      });
    }

    if (!staff.isActive) {
      throw new ForbiddenException('Account deactivated. Contact admin.');
    }

    return this.generateToken(staff, 'STAFF');
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

  async requestStaffPasswordReset(dto: StaffPasswordResetRequestDto) {
    const staff = await this.findStaffByIdentifier(dto.identifier);
    if (!staff) {
      return { message: 'If the account exists, an OTP has been sent.' };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { phone: dto.identifier, code, expiresAt },
    });

    const isEmail = dto.identifier.includes('@');
    if (isEmail) {
      console.log(`[email mock] reset code ${code} -> ${dto.identifier}`);
    } else {
      await this.sms.send({
        to: dto.identifier,
        body: `Your Viju password reset code is ${code}. Expires in 10 minutes.`,
      });
    }

    return { message: 'If the account exists, an OTP has been sent.' };
  }

  async confirmStaffPasswordReset(dto: StaffPasswordResetConfirmDto) {
    const otp = await this.prisma.otpVerification.findFirst({
      where: { phone: dto.identifier },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('No reset request found.');
    if (otp.expiresAt < new Date())
      throw new BadRequestException('Reset code expired.');
    if (otp.lockedUntil && otp.lockedUntil > new Date())
      throw new ForbiddenException('Too many attempts. Try again later.');

    if (otp.code !== dto.code) {
      await this.prisma.otpVerification.update({
        where: { id: otp.id },
        data: {
          attempts: otp.attempts + 1,
          lockedUntil:
            otp.attempts + 1 >= 3
              ? new Date(Date.now() + 30 * 60 * 1000)
              : null,
        },
      });
      throw new UnauthorizedException('Invalid code.');
    }

    const staff = await this.findStaffByIdentifier(dto.identifier);
    if (!staff) throw new NotFoundException('Account not found.');

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null },
    });

    await this.prisma.otpVerification.deleteMany({
      where: { phone: dto.identifier },
    });

    return { message: 'Password updated. You can now log in.' };
  }

  private findStaffByIdentifier(identifier: string) {
    return this.prisma.staff.findFirst({
      where: identifier.includes('@')
        ? { email: identifier }
        : { phone: identifier },
    });
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
