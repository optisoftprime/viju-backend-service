import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { isDevMode } from '../../common/utils/env';

export interface OtpSendResult {
  /** The code, ONLY returned in dev by the local provider (never in prod / ezone). */
  devCode?: string;
}

/**
 * OTP provider abstraction. Two implementations are wired by the OTP_PROVIDER env:
 *   - local  (default): app generates + stores + verifies the code, sends via SMS.
 *   - ezone            : delegates generate/send/verify to the Ezone OTP service.
 */
export abstract class OtpService {
  /** Generate and send a one-time code to the phone. */
  abstract send(phone: string): Promise<OtpSendResult>;

  /**
   * Verify a code for the phone. Resolves on success; throws
   * BadRequestException / UnauthorizedException on failure (same contract for
   * every provider, so callers stay provider-agnostic).
   */
  abstract verify(phone: string, code: string): Promise<void>;
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;
const LOCK_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Local OTP provider — the app owns the code lifecycle (this is the behaviour the
 * auth flow had inline before the provider abstraction). Codes live in
 * OtpVerification and are sent through the configured SmsService.
 */
@Injectable()
export class LocalOtpService extends OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {
    super();
  }

  async send(phone: string): Promise<OtpSendResult> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await this.prisma.otpVerification.create({
      data: { phone, code, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });

    await this.sms.send({
      to: phone,
      body: `Your Viju verification code is ${code}. It expires in 10 minutes.`,
    });

    return isDevMode() ? { devCode: code } : {};
  }

  async verify(phone: string, code: string): Promise<void> {
    const otp = await this.prisma.otpVerification.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) throw new BadRequestException('No OTP found for this number');
    if (otp.lockedUntil && otp.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account locked due to too many attempts. Please try again later.',
      );
    }
    if (otp.expiresAt < new Date()) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    if (otp.code !== code) {
      const attempts = otp.attempts + 1;
      await this.prisma.otpVerification.update({
        where: { id: otp.id },
        data: {
          attempts,
          lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS) : null,
        },
      });
      throw new UnauthorizedException('Invalid OTP code');
    }

    // Success — clear any outstanding codes for this number.
    await this.prisma.otpVerification.deleteMany({ where: { phone } });
  }
}
