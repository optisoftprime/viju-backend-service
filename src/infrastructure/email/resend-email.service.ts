import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailMessage, EmailService } from './email.types';

/**
 * Resend (https://resend.com) HTTP-API email provider.
 *
 * Required env:
 *   RESEND_API_KEY=re_xxx
 *   EMAIL_FROM=noreply@yourdomain.com   (must be a verified Resend sender)
 *
 * Optional env:
 *   EMAIL_FROM_NAME=Viju
 *
 * Missing creds fail soft — logs a warning at boot and degrades to
 * console-logging on send. The app never crashes because of email.
 */
@Injectable()
export class ResendEmailService extends EmailService implements OnModuleInit {
  private readonly logger = new Logger('ResendEmail');
  private apiKey: string | null = null;
  private from: string | null = null;

  onModuleInit() {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      this.logger.warn(
        '⚠️ EMAIL_PROVIDER=resend but RESEND_API_KEY or EMAIL_FROM is unset. ' +
          'Falling back to logging emails only.',
      );
      return;
    }
    this.apiKey = key;
    const fromName = process.env.EMAIL_FROM_NAME;
    this.from = fromName ? `${fromName} <${from}>` : from;
    this.logger.log(`Resend ready (from: ${this.from})`);
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.apiKey || !this.from) {
      this.logger.log(
        `[email-fallback] -> ${message.to}\n  Subject: ${message.subject}\n  ${message.body}`,
      );
      return;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.body,
          ...(message.html ? { html: message.html } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        this.logger.error(
          `Resend send failed (${res.status}) to ${message.to}: ${text.slice(0, 200)}`,
        );
        return;
      }
      this.logger.log(`Sent via Resend -> ${message.to}: ${message.subject}`);
    } catch (e) {
      this.logger.error(
        `Resend send threw for ${message.to}: ${(e as Error).message}`,
      );
    }
  }
}
