import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import {
  NotificationGateway,
  NotificationPayload,
  PushDispatchResult,
} from './notification.types';

const FCM_INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

@Injectable()
export class FcmNotificationGateway
  extends NotificationGateway
  implements OnModuleInit
{
  private readonly logger = new Logger('FcmGateway');
  private app: admin.app.App | null = null;

  /**
   * Initialisation never throws. Bad creds / missing creds / SDK errors
   * all result in a warning log and a no-op gateway. The app boots regardless.
   */
  onModuleInit() {
    try {
      const credential = this.loadCredential();
      if (!credential) {
        this.logger.warn(
          '⚠️ FCM is selected as PUSH_PROVIDER but no credentials were found. ' +
            'Set FIREBASE_SERVICE_ACCOUNT (path), FIREBASE_SERVICE_ACCOUNT_JSON ' +
            '(inline), or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + ' +
            'FIREBASE_PRIVATE_KEY. Push will be a no-op until creds are added.',
        );
        return;
      }
      this.app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential });
      this.logger.log(
        `Initialised Firebase Admin (project: ${this.app.options.projectId ?? 'unknown'})`,
      );
    } catch (e) {
      this.logger.error(
        `Firebase Admin init failed: ${(e as Error).message}. Push will be a no-op.`,
      );
      this.app = null;
    }
  }

  async dispatch(
    payload: NotificationPayload,
    tokens: string[],
  ): Promise<PushDispatchResult> {
    if (!this.app || tokens.length === 0) {
      return {
        delivered: 0,
        failed: tokens.length,
        tokensRemovedAsInvalid: [],
      };
    }

    try {
      const response = await admin.messaging(this.app).sendEachForMulticast({
        tokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: {
          ...(payload.type ? { type: payload.type } : {}),
          ...(payload.data ?? {}),
        },
      });

      const invalid: string[] = [];
      response.responses.forEach((r, i) => {
        if (!r.success && r.error) {
          const code = r.error.code;
          if (FCM_INVALID_TOKEN_ERROR_CODES.has(code)) invalid.push(tokens[i]);
        }
      });

      return {
        delivered: response.successCount,
        failed: response.failureCount,
        tokensRemovedAsInvalid: invalid,
      };
    } catch (e) {
      // SDK-level failure (network, expired creds, etc.) — degrade
      // gracefully so the trigger flow (chat / ticket / etc.) never
      // sees an error from us.
      this.logger.error(
        `FCM dispatch failed: ${(e as Error).message}. ` +
          `Dropping ${tokens.length} token(s) for this call.`,
      );
      return {
        delivered: 0,
        failed: tokens.length,
        tokensRemovedAsInvalid: [],
      };
    }
  }

  private loadCredential(): admin.credential.Credential | null {
    const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (jsonInline) {
      try {
        const parsed: admin.ServiceAccount = JSON.parse(jsonInline);
        return admin.credential.cert(parsed);
      } catch (e) {
        this.logger.error(
          `Could not parse FIREBASE_SERVICE_ACCOUNT_JSON: ${(e as Error).message}`,
        );
        return null;
      }
    }
    const path = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (path) {
      try {
        return admin.credential.cert(path);
      } catch (e) {
        this.logger.error(
          `Could not load FIREBASE_SERVICE_ACCOUNT from ${path}: ${(e as Error).message}`,
        );
        return null;
      }
    }
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (projectId && clientEmail && privateKey) {
      return admin.credential.cert({ projectId, clientEmail, privateKey });
    }
    return null;
  }
}
