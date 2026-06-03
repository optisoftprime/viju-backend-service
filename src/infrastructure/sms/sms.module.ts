import { Module } from '@nestjs/common';
import { ConsoleSmsService, SmsService } from './sms.service';

@Module({
  providers: [
    {
      provide: SmsService,
      useClass: ConsoleSmsService,
    },
  ],
  exports: [SmsService],
})
export class SmsModule {}
