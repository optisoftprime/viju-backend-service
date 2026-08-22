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
  /**
   * N-1 - the distributor this notification is ABOUT, on a staff-bound row.
   *
   * Distinct from `recipientId`, which is always the person being notified.
   * It gives the bell a deep-link target ("open ADLAK's chat") without a
   * second lookup, and it is what lets a client tell a staff row concerning a
   * customer apart from a customer's own row.
   *
   * Ignored when `recipientType` is CUSTOMER - there the recipient IS the
   * customer, and setting both would make a staff row indistinguishable from
   * a customer-feed row.
   */
  subjectCustomerId?: string;
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
