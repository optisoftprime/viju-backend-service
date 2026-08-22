import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Region } from '../../common/region/region.constants';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { SendMessageDto } from './dto/chat.dto';
import {
  STAFF_SENDER_SELECT,
  withStaffSender,
  withStaffSenders,
} from '../../common/messaging/staff-sender';

/**
 * The authenticated principal behind a chat call, as the controller reads it
 * off the JWT. `region` is populated for region-scoped staff only and is the
 * ONLY source of a REGIONAL_ADMIN's scope - never a query param or a body.
 */
export interface ChatActor {
  id: string;
  role: string;
  region?: Region | null;
}

/**
 * AD-C1 - roles that read and write a customer's thread from the Interaction
 * Audit rather than from an officer assignment. An ADMIN reaches every
 * customer; a REGIONAL_ADMIN only their own region.
 */
const AUDIT_STAFF_ROLES = ['ADMIN', 'REGIONAL_ADMIN'] as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Publishes one `chat.message` frame per live recipient (US-11.2). */
  private publishMessage(
    message: {
      id: string;
      content: string | null;
      attachmentUrl: string | null;
      createdAt: Date;
    },
    senderId: string,
    recipients: { type: 'CUSTOMER' | 'STAFF'; id: string }[],
  ): void {
    for (const recipient of recipients) {
      this.realtime.publish({
        event: 'chat.message',
        recipientType: recipient.type,
        recipientId: recipient.id,
        data: {
          id: message.id,
          senderId,
          receiverId: recipient.id,
          content: message.content,
          attachmentUrl: message.attachmentUrl,
          createdAt: message.createdAt,
        },
      });
    }
  }

  /**
   * True if the officer manages the customer — as primary (assignedOfficerId)
   * OR secondary (CustomerOfficer). Mirrors OfficerService.ensureAssignedCustomer
   * and GET /officers/customers, so chat access matches the assigned list.
   */
  private async isAssignedPair(
    customerId: string,
    officerId: string,
  ): Promise<boolean> {
    const match = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        OR: [
          { assignedOfficerId: officerId },
          { officerAssignments: { some: { staffId: officerId } } },
        ],
      },
      select: { id: true },
    });
    return !!match;
  }

  /**
   * AD-C1 - resolves the customer whose thread an ADMIN / REGIONAL_ADMIN is
   * asking for, and enforces the region rule.
   *
   * The path parameter is the CUSTOMER id for these roles: an admin is not a
   * participant in the thread, they are auditing one. A REGIONAL_ADMIN is
   * refused with 403 outside their own region, matching
   * GET /admin/audit/chats; an ADMIN reaches every region.
   */
  private async resolveAuditedCustomer(user: ChatActor, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, region: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (
      user.role === 'REGIONAL_ADMIN' &&
      customer.region !== (user.region ?? null)
    ) {
      throw new ForbiddenException(
        'You can only access customers in your own region.',
      );
    }
    return customer;
  }

  /** True for the two roles that read/write a thread through the audit. */
  private isAuditStaff(role: string): boolean {
    return (AUDIT_STAFF_ROLES as readonly string[]).includes(role);
  }

  /**
   * S-1 - the staff-facing thread names its author.
   *
   * A CUSTOMER caller is deliberately excluded: PRD F6 says a distributor sees
   * one label, 'Viju Account Officer', and never an individual staff name.
   * Returning `staff` to them on this legacy route would leak exactly what F6
   * hides, so a customer's rows come back with `staff: null` and the label is
   * still derived on the client.
   */
  private maySeeStaffAuthor(role: string): boolean {
    return role !== 'CUSTOMER';
  }

  /** Chronological thread for one account, oldest first. */
  private async threadFor(customerId: string, withAuthors: boolean) {
    const messages = await this.prisma.message.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      ...(withAuthors
        ? { include: { staff: { select: STAFF_SENDER_SELECT } } }
        : {}),
    });
    // withStaffSender also nulls the block on a CUSTOMER-authored row, whose
    // `staffId` names the officer it was routed TO rather than its author.
    return withAuthors
      ? withStaffSenders(messages as never[])
      : messages.map((m) => ({ ...m, staff: null }));
  }

  async getMessages(user: ChatActor, otherUserId: string) {
    // AD-C1 - an ADMIN / REGIONAL_ADMIN passes the CUSTOMER id and gets the
    // whole thread for that account, in exactly the shape the officer flow
    // returns, so the same components render it.
    if (this.isAuditStaff(user.role)) {
      await this.resolveAuditedCustomer(user, otherUserId);
      return this.threadFor(otherUserId, true);
    }
    if (user.role === 'CUSTOMER') {
      if (!(await this.isAssignedPair(user.id, otherUserId))) {
        throw new ForbiddenException(
          'You can only chat with your assigned account officer.',
        );
      }
      // US-13.5: the whole thread for this account, not only the messages
      // that happen to carry one officer's id. A reassignment must not hide
      // history from either side.
      return this.threadFor(user.id, this.maySeeStaffAuthor(user.role));
    } else if (user.role === 'OFFICER') {
      if (!(await this.isAssignedPair(otherUserId, user.id))) {
        throw new ForbiddenException(
          'You can only chat with customers assigned to you.',
        );
      }
      // Same guarantee from the officer side: a newly assigned officer sees
      // every pre-existing message, and the previous officer - no longer
      // assigned - is refused by the check above.
      return this.threadFor(otherUserId, true);
    }
  }

  /**
   * AD-C1 - a staff or customer message on a customer's thread.
   *
   * For an ADMIN / REGIONAL_ADMIN, `receiverId` is the CUSTOMER id and the
   * message is stored with the REPLYING ADMIN'S OWN `staffId`, so the audit
   * trail shows who actually answered rather than crediting the assigned
   * officer. The customer still sees the message under the
   * 'Viju Account Officer' label (PRD F6) - individual staff names are never
   * exposed to a distributor.
   */
  async sendMessage(user: ChatActor, receiverId: string, dto: SendMessageDto) {
    let customerId = '';
    let staffId = '';
    let senderType = '';

    if (this.isAuditStaff(user.role)) {
      await this.resolveAuditedCustomer(user, receiverId);
      customerId = receiverId;
      staffId = user.id;
      senderType = 'STAFF';
    } else if (user.role === 'CUSTOMER') {
      if (!(await this.isAssignedPair(user.id, receiverId))) {
        throw new ForbiddenException(
          'You can only send messages to your assigned account officer.',
        );
      }
      customerId = user.id;
      staffId = receiverId;
      senderType = 'CUSTOMER';
    } else if (user.role === 'OFFICER') {
      if (!(await this.isAssignedPair(receiverId, user.id))) {
        throw new ForbiddenException(
          'You can only send messages to your assigned customers.',
        );
      }
      customerId = receiverId;
      staffId = user.id;
      senderType = 'STAFF';
    }

    const message = await this.prisma.message.create({
      data: {
        customerId,
        staffId,
        senderType,
        content: dto.content?.trim() || null,
        attachmentUrl: dto.attachmentUrl || null,
      },
      // S-1 - the created row names its author, so the composer can append it
      // to the thread without a refetch.
      include: { staff: { select: STAFF_SENDER_SELECT } },
    });

    // PRD §6 notification triggers
    if (senderType === 'STAFF') {
      // Customer-facing display name is always 'Viju Account Officer' (PRD F6)
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: customerId,
        title: 'Viju Account Officer',
        body: (dto.content ?? '').slice(0, 120),
        type: NotificationTypes.CHAT_MESSAGE,
        data: { messageId: message.id },
      });
      this.publishMessage(message, staffId, [
        { type: 'CUSTOMER', id: customerId },
      ]);
    } else {
      // N-1: exactly ONE recipient - the staff member this conversation
      // belongs to, which is the `staffId` stored on the message itself. If
      // officer A is chatting with customer B, only officer A is notified;
      // another officer on the same account, an admin and a regional admin
      // must not see the row at all.
      //
      // This deliberately narrows US-11.8, which fanned the row out to every
      // officer currently managing the customer. A row addressed to someone
      // with no part in the conversation cannot be un-sent, and the reader
      // cannot tell it apart from one meant for them.
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { name: true },
      });
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: staffId,
        subjectCustomerId: customerId,
        title: `New message from ${customer?.name ?? 'distributor'}`,
        body: (dto.content ?? '').slice(0, 120),
        type: NotificationTypes.CHAT_MESSAGE,
        data: { messageId: message.id, customerId },
      });
      // The live frame follows the notification: one recipient, not a fan-out.
      this.publishMessage(message, customerId, [
        { type: 'STAFF', id: staffId },
      ]);
    }

    return withStaffSender(message);
  }

  /**
   * Read-only audit of one customer's whole thread. Same region rule as the
   * live thread: an ADMIN reaches every customer, a REGIONAL_ADMIN only their
   * own region.
   */
  async getAudits(user: ChatActor, customerId: string) {
    await this.resolveAuditedCustomer(user, customerId);
    return this.threadFor(customerId, true);
  }

  /**
   * PRD F6: Customer-facing chat thread. Both officers route through
   * here; messages from either officer appear under 'Viju Account Officer'.
   */
  async getCustomerThread(customerId: string) {
    const messages = await this.prisma.message.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        content: true,
        attachmentUrl: true,
        senderType: true,
        createdAt: true,
        readAt: true,
      },
    });
    return messages.map((m) => ({
      ...m,
      senderLabel: m.senderType === 'STAFF' ? 'Viju Account Officer' : 'You',
    }));
  }

  /**
   * PRD F6: Customer sends to their account-officer team. They don't pick
   * a specific officer — the message is recorded against the primary
   * officer; both primary + secondary are notified.
   */
  async sendFromCustomer(customerId: string, dto: SendMessageDto) {
    const assignments = await this.prisma.customerOfficer.findMany({
      where: { customerId },
      orderBy: { isPrimary: 'desc' },
      select: { staffId: true, isPrimary: true },
    });
    if (assignments.length === 0) {
      // Legacy fallback — single assigned officer
      const customer = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { assignedOfficerId: true },
      });
      if (!customer?.assignedOfficerId) {
        throw new ForbiddenException(
          'No account officer is assigned to your account yet. Please contact Viju.',
        );
      }
      assignments.push({
        staffId: customer.assignedOfficerId,
        isPrimary: true,
      });
    }

    const primary = assignments[0];
    const message = await this.prisma.message.create({
      data: {
        customerId,
        staffId: primary.staffId,
        senderType: 'CUSTOMER',
        content: dto.content?.trim() || null,
        attachmentUrl: dto.attachmentUrl || null,
      },
    });

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });
    // N-1: one recipient - the primary officer, who is the staff member this
    // conversation belongs to and the one the message was recorded against.
    // A secondary officer or an admin has no part in it and must not receive
    // the row.
    await this.notifications.notify({
      recipientType: 'STAFF',
      recipientId: primary.staffId,
      subjectCustomerId: customerId,
      title: `New message from ${customer?.name ?? 'distributor'}`,
      body: (dto.content ?? '').slice(0, 120),
      type: NotificationTypes.CHAT_MESSAGE,
      data: { messageId: message.id, customerId },
    });
    this.publishMessage(message, customerId, [
      { type: 'STAFF', id: primary.staffId },
    ]);

    return {
      ...message,
      senderLabel: 'You',
    };
  }

  async markCustomerThreadRead(customerId: string) {
    await this.prisma.message.updateMany({
      where: { customerId, senderType: 'STAFF', readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
