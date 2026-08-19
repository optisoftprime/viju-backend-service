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
  StaffPasswordResetVerifyOtpDto,
  StaffPasswordResetWithTokenDto,
} from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { OtpService } from '../../infrastructure/otp/otp.service';
import { ErpService } from '../../infrastructure/erp/erp.types';
import { EmailService } from '../../infrastructure/email/email.types';
import { StaffRole } from '@prisma/client';
import { isDevMode } from '../../common/utils/env';
import { tryRegionFromBpClusterCode } from '../../common/region/region.constants';

const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_LOCK_MINUTES = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly sms: SmsService,
    private readonly erp: ErpService,
    private readonly email: EmailService,
    private readonly otp: OtpService,
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

    // Delegate to the configured OTP provider (local or Ezone). devCode is only
    // ever returned by the local provider in dev; Ezone owns + delivers its code.
    const { devCode } = await this.otp.send(dto.phone);

    return {
      message: 'OTP sent successfully',
      ...(devCode && {
        devOtp: devCode,
        devNote:
          'OTP is included in this response because NODE_ENV !== "production". Never enable dev mode in prod.',
      }),
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    // Provider verifies the code (throws BadRequest/Unauthorized on failure).
    await this.otp.verify(dto.phone, dto.code);

    const customer = await this.prisma.customer.findFirst({
      where: { phone: dto.phone },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { password: hashedPassword },
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

    // The ERP reports the posting as a numeric BP_CLUSTER_CODE; translate it
    // once, here, so nothing downstream ever sees the number. Staff.region is
    // nullable, so an absent or unrecognised code degrades to null rather than
    // blocking the login - a regionless staff member is already handled by
    // RegionalController.resolveRegion().
    const region = tryRegionFromBpClusterCode(erpStaff.bpClusterCode);

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
          role: erpStaff.role,
          region,
        },
        create: {
          name: erpStaff.name,
          email: erpStaff.email,
          phone: erpStaff.phone,
          username: erpStaff.username,
          erpCode: erpStaff.erpCode,
          role: erpStaff.role,
          region,
        },
      });
    }

    if (!staff.isActive) {
      throw new ForbiddenException('Account deactivated. Contact admin.');
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

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

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

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
    try {
      if (isEmail) {
        await this.email.send({
          to: dto.identifier,
          subject: 'Your Viju password reset code',
          body: [
            `Hello,`,
            '',
            `Your Viju Account Officer Portal password reset code is: ${code}`,
            '',
            'This code expires in 10 minutes. If you did not request a reset,',
            'you can ignore this email.',
            '',
            'Viju Team',
          ].join('\n'),
        });
      } else {
        await this.sms.send({
          to: dto.identifier,
          body: `Your Viju password reset code is ${code}. Expires in 10 minutes.`,
        });
      }
    } catch {
      // Provider failures are already logged inside the impl; never
      // leak the failure to the caller because that would also leak
      // whether the identifier exists.
    }

    return {
      message: 'If the account exists, an OTP has been sent.',
      ...(isDevMode() && { devOtp: code }),
    };
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

  /**
   * Step 2 of the 3-step reset flow (Screen 2 "Verify"):
   * Checks the OTP only and issues a short-lived reset_token. The OTP
   * row stays in the table (not deleted) so the rate-limit / lockout
   * state remains useful; the token is what the next call relies on.
   */
  async verifyStaffPasswordResetOtp(dto: StaffPasswordResetVerifyOtpDto) {
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

    // Reset the attempts counter now that the code is correct so the
    // user doesn't lose their slot if they take a moment to type a
    // password.
    await this.prisma.otpVerification.update({
      where: { id: otp.id },
      data: { attempts: 0 },
    });

    // Short-lived reset token. Marker `type: 'PASSWORD_RESET'` prevents
    // any other JWT (login, refresh) from being accepted at the reset
    // endpoint by mistake.
    const reset_token = this.jwtService.sign(
      { sub: staff.id, type: 'PASSWORD_RESET', identifier: dto.identifier },
      { expiresIn: '10m' },
    );

    return {
      message: 'OTP verified. Proceed to set a new password.',
      reset_token,
      expires_in: 600,
    };
  }

  /**
   * Step 3 of the 3-step reset flow (Screen 3 "Verify"):
   * Validates the reset_token from step 2 and writes the new password.
   * Once consumed, all OTP rows for the identifier are wiped so the
   * reset_token can't be reused.
   */
  async resetStaffPasswordWithToken(dto: StaffPasswordResetWithTokenDto) {
    let payload: { sub: string; type: string; identifier: string };
    try {
      payload = this.jwtService.verify(dto.reset_token);
    } catch {
      throw new UnauthorizedException(
        'Reset token is invalid or has expired. Start the flow again.',
      );
    }

    if (payload.type !== 'PASSWORD_RESET') {
      throw new UnauthorizedException(
        'This token is not valid for password reset.',
      );
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: payload.sub },
    });
    if (!staff) throw new NotFoundException('Account not found.');

    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null },
    });

    // Wipe OTP rows so the same code (and the reset_token's window) can't
    // be replayed.
    await this.prisma.otpVerification.deleteMany({
      where: { phone: payload.identifier },
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

  private async generateToken(user: any, entityType: 'CUSTOMER' | 'STAFF') {
    const role = entityType === 'CUSTOMER' ? 'CUSTOMER' : user.role;

    const refreshTokenRow = await this.prisma.refreshToken.create({
      data: {
        ...(entityType === 'CUSTOMER'
          ? { customerId: user.id }
          : { staffId: user.id }),
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
      },
    });

    const accessPayload = { sub: user.id, role, type: entityType };
    const refreshPayload = {
      sub: user.id,
      type: entityType,
      jti: refreshTokenRow.id,
      kind: 'refresh' as const,
    };

    const access_token = this.jwtService.sign(accessPayload);
    const refresh_token = this.jwtService.sign(refreshPayload, {
      expiresIn: REFRESH_EXPIRY_SECONDS,
    });

    return {
      access_token,
      refresh_token,
      expires_in: ACCESS_EXPIRY_SECONDS,
      refresh_expires_in: REFRESH_EXPIRY_SECONDS,
      user: { id: user.id, name: user.name, role, region: user.region ?? null },
    };
  }

  /**
   * Validate a refresh token, rotate it, and return a new token pair.
   * Reuse of an already-revoked token is treated as a potential theft
   * signal — we revoke the WHOLE chain and force re-login.
   */
  async refresh(refreshToken: string) {
    let payload: {
      sub: string;
      jti: string;
      type: 'CUSTOMER' | 'STAFF';
      kind: string;
    };
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (payload.kind !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Token is not a refresh token.');
    }

    const row = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });
    if (!row) {
      throw new UnauthorizedException('Refresh token not recognised.');
    }
    if (row.revokedAt) {
      // Token reuse — revoke the entire chain as defence in depth.
      await this.revokeChain(row.id);
      throw new UnauthorizedException(
        'Refresh token has been revoked. Please log in again.',
      );
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Refresh token expired. Please log in again.',
      );
    }

    const user =
      payload.type === 'CUSTOMER'
        ? await this.prisma.customer.findUnique({ where: { id: payload.sub } })
        : await this.prisma.staff.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User no longer exists.');

    const fresh = await this.generateToken(user, payload.type);
    // Mark the old row revoked + chained to the new one
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    // (replacedById is set on the OLD row, pointing at the new jti)
    const newJti = this.jwtService.decode(fresh.refresh_token);
    if (newJti?.jti) {
      await this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { replacedById: newJti.jti },
      });
    }
    return fresh;
  }

  async logout(refreshToken: string): Promise<{ message: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      if (payload.jti) {
        await this.prisma.refreshToken.updateMany({
          where: { id: payload.jti, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Already invalid — treat as logged out
    }
    return { message: 'Logged out.' };
  }

  private async revokeChain(rootId: string) {
    // Walk forward via replacedById and revoke any non-revoked descendant
    let current: string | null = rootId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = await this.prisma.refreshToken.findUnique({
        where: { id: current },
      });
      if (!row) break;
      if (!row.revokedAt) {
        await this.prisma.refreshToken.update({
          where: { id: row.id },
          data: { revokedAt: new Date() },
        });
      }
      current = row.replacedById;
    }
  }
}

const ACCESS_EXPIRY_SECONDS = parseDurationToSeconds(
  process.env.JWT_EXPIRATION ?? '1h',
);
const REFRESH_EXPIRY_SECONDS = parseDurationToSeconds(
  process.env.JWT_REFRESH_EXPIRATION ?? '30d',
);
const REFRESH_EXPIRY_MS = REFRESH_EXPIRY_SECONDS * 1000;

function parseDurationToSeconds(input: string): number {
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) return 3600;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return 3600;
  }
}
