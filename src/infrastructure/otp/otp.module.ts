import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SmsModule } from '../sms/sms.module';
import { SmsService } from '../sms/sms.service';
import { EzoneOtpService } from './ezone-otp.service';
import { LocalOtpService, OtpService } from './otp.service';

/**
 * Binds OtpService to the provider named by OTP_PROVIDER:
 *   OTP_PROVIDER=ezone → EzoneOtpService (Ezone generates/sends/validates)
 *   anything else       → LocalOtpService (app-managed codes over SMS) [default]
 */
@Module({
  imports: [SmsModule],
  providers: [
    PrismaService,
    {
      provide: OtpService,
      inject: [PrismaService, SmsService],
      useFactory: (prisma: PrismaService, sms: SmsService) =>
        process.env.OTP_PROVIDER === 'ezone'
          ? new EzoneOtpService()
          : new LocalOtpService(prisma, sms),
    },
  ],
  exports: [OtpService],
})
export class OtpModule {}
