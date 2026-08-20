import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from '../../infrastructure/email/email.types';
import { CreateContactMessageDto } from './dto/contact.dto';

const ACKNOWLEDGEMENT =
  "Thanks for reaching out. We'll get back to you within 24 hours.";

@Injectable()
export class ContactService {
  private readonly logger = new Logger('ContactService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /**
   * CC-05 — records a public contact-form submission and notifies the sales
   * inbox.
   *
   * The row is the record of the enquiry, so it is written first and failures
   * there surface to the caller. The email is best-effort on top: a
   * misconfigured mail provider must not lose a lead or show the visitor an
   * error for something that already succeeded.
   */
  async submit(
    dto: CreateContactMessageDto,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<{ message: string }> {
    const record = await this.prisma.contactMessage.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email.trim(),
        phone: dto.phone.trim(),
        message: dto.message.trim(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    const recipient = process.env.CONTACT_INBOX_EMAIL;
    if (recipient) {
      try {
        await this.email.send({
          to: recipient,
          subject: `New contact enquiry from ${record.fullName}`,
          replyTo: record.email,
          body: [
            `Name:  ${record.fullName}`,
            `Email: ${record.email}`,
            `Phone: ${record.phone}`,
            '',
            record.message,
            '',
            `Received: ${record.createdAt.toISOString()}`,
          ].join('\n'),
        });
      } catch (e) {
        this.logger.error(
          `Contact notification email failed for ${record.id} — ` +
            `${(e as Error).message}. The submission was still recorded.`,
        );
      }
    } else {
      this.logger.warn(
        `CONTACT_INBOX_EMAIL is not set — enquiry ${record.id} was recorded ` +
          'but nobody was notified by email.',
      );
    }

    return { message: ACKNOWLEDGEMENT };
  }
}
