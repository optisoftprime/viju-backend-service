import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailService } from './email.types';

/**
 * Generic SMTP email provider. Works for Gmail (smtp.gmail.com:587 with
 * an App Password), Mailgun, Postmark, Outlook, custom relays.
 *
 * Required env:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=<16-char Gmail App Password — generate via Google Account → Security>
 *   EMAIL_FROM=you@gmail.com
 *
 * Optional env:
 *   SMTP_SECURE=true   (force TLS on port 465; defaults to false → STARTTLS on 587)
 *   EMAIL_FROM_NAME=Viju
 *
 * Missing creds fail soft — logs a warning at boot and degrades to
 * console-logging on send. The app never crashes because of email.
 */
@Injectable()
export class SmtpEmailService extends EmailService implements OnModuleInit {
  private readonly logger = new Logger('SmtpEmail');
  private transporter: nodemailer.Transporter | null = null;
  private from: string | null = null;

  onModuleInit() {
    try {
      const host = process.env.SMTP_HOST ?? process.env.SPRING_MAIL_HOST;
      const port = Number(
        process.env.SMTP_PORT ?? process.env.SPRING_MAIL_PORT ?? '587',
      );
      const user = process.env.SMTP_USER ?? process.env.SPRING_MAIL_USERNAME;
      const pass = process.env.SMTP_PASS ?? process.env.SPRING_MAIL_PASSWORD;
      const from = process.env.EMAIL_FROM ?? user;
      if (!host || !user || !pass || !from) {
        this.logger.warn(
          '⚠️ EMAIL_PROVIDER=smtp but SMTP_HOST/SMTP_USER/SMTP_PASS or EMAIL_FROM ' +
            'is unset. Falling back to logging emails only.',
        );
        return;
      }
      // Optional timeouts (ms). Spring-style env names accepted as
      // aliases so existing infra env files Just Work.
      const connectionTimeout = Number(
        process.env.SMTP_CONNECTION_TIMEOUT ??
          process.env.SPRING_MAIL_PROPERTIES_MAIL_SMTP_CONNECTIONTIMEOUT ??
          '10000',
      );
      const socketTimeout = Number(
        process.env.SMTP_SOCKET_TIMEOUT ??
          process.env.SPRING_MAIL_PROPERTIES_MAIL_SMTP_TIMEOUT ??
          '10000',
      );
      const greetingTimeout = Number(
        process.env.SMTP_GREETING_TIMEOUT ?? '10000',
      );

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user, pass },
        connectionTimeout,
        socketTimeout,
        greetingTimeout,
      });
      const fromName = process.env.EMAIL_FROM_NAME;
      this.from = fromName ? `${fromName} <${from}>` : from;
      this.logger.log(`SMTP ready (host: ${host}:${port}, from: ${this.from})`);
    } catch (e) {
      this.logger.error(
        `SMTP transport init failed: ${(e as Error).message}. ` +
          'Falling back to logging emails only.',
      );
      this.transporter = null;
    }
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.transporter || !this.from) {
      this.logger.log(
        `[email-fallback] -> ${message.to}\n  Subject: ${message.subject}\n  ${message.body}`,
      );
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
      this.logger.log(
        `Sent via SMTP -> ${message.to}: ${message.subject} (messageId: ${info.messageId})`,
      );
    } catch (e) {
      this.logger.error(
        `SMTP send threw for ${message.to}: ${(e as Error).message}`,
      );
    }
  }
}
