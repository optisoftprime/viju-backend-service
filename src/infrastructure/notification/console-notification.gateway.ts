import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationGateway,
  NotificationPayload,
  PushDispatchResult,
} from './notification.types';

@Injectable()
export class ConsoleNotificationGateway extends NotificationGateway {
  private readonly logger = new Logger('NotificationGateway');

  async dispatch(
    payload: NotificationPayload,
    tokens: string[],
  ): Promise<PushDispatchResult> {
    this.logger.log(
      `[push] -> ${payload.recipientType}:${payload.recipientId} (${tokens.length} tokens) ${payload.title}: ${payload.body}`,
    );
    return Promise.resolve({
      delivered: tokens.length,
      failed: 0,
      tokensRemovedAsInvalid: [],
    });
  }
}
