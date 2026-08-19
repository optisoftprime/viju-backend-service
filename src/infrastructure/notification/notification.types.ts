export type NotificationRecipientType = 'CUSTOMER' | 'STAFF';

export interface NotificationPayload {
  recipientType: NotificationRecipientType;
  recipientId: string;
  title: string;
  body: string;
  type?: string;
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
