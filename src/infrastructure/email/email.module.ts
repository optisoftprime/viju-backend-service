import { Module } from '@nestjs/common';
import { ConsoleEmailService } from './console-email.service';
import { ResendEmailService } from './resend-email.service';
import { SmtpEmailService } from './smtp-email.service';
import { EmailService } from './email.types';

function pickProvider() {
  switch ((process.env.EMAIL_PROVIDER ?? '').toLowerCase()) {
    case 'resend':
      return ResendEmailService;
    case 'smtp':
    case 'gmail':
      return SmtpEmailService;
    default:
      return ConsoleEmailService;
  }
}

@Module({
  providers: [
    {
      provide: EmailService,
      // EMAIL_PROVIDER=resend → Resend HTTP API
      // EMAIL_PROVIDER=smtp   → SMTP (Gmail / Mailgun / Postmark / etc.)
      // anything else         → console logger (dev default)
      useClass: pickProvider(),
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
