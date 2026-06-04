import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailService } from './email.types';

@Injectable()
export class ConsoleEmailService extends EmailService {
  private readonly logger = new Logger('EmailService');

  send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `[email] -> ${message.to}\n  Subject: ${message.subject}\n  ${message.body}`,
    );
    return Promise.resolve();
  }
}
