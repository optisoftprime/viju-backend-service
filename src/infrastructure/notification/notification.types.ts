import { NotificationType } from '../../common/notifications/notification-types';

export type NotificationRecipientType = 'CUSTOMER' | 'STAFF';

export interface NotificationPayload {
  recipientType: NotificationRecipientType;
  recipientId: string;
  title: string;
  body: string;
  /**
   * Category tag, from the closed set in
   * common/notifications/notification-types.ts. The web bell and the mobile
   * app both switch on it to pick an icon and route the click, so it must
   * never be an ad-hoc string.
   */
  type?: NotificationType;
  data?: Record<string, string>;
}

export interface PushDispatchResult {
  delivered: number;
  failed: number;
  tokensRemovedAsInvalid: string[];
}

export abstract class NotificationGateway {
  abstract dispatch(
    payload: NotificationPayload,
    tokens: string[],
  ): Promise<PushDispatchResult>;
}
