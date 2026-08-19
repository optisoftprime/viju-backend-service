import { Injectable, Logger } from '@nestjs/common';

export interface SmsMessage {
  to: string;
  body: string;
}

export abstract class SmsService {
  abstract send(message: SmsMessage): Promise<void>;
}

@Injectable()
export class ConsoleSmsService extends SmsService {
  private readonly logger = new Logger('SmsService');

  send(message: SmsMessage): Promise<void> {
    this.logger.log(`[sms] -> ${message.to}: ${message.body}`);
    return Promise.resolve();
  }
}
