import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { paginate } from '../../common/pagination/paginate';
import {
  SendRegionalBroadcastDto,
  SendIndividualBroadcastDto,
  BroadcastHistoryFilterDto,
} from './dto/broadcast.dto';

/**
 * P-5 — the credited allowance, as a distributor reads it.
 *
 * Two rules, both from the frontend's AO-D1 note: group the thousands, and
 * NEVER round. `maximumFractionDigits` is set high enough that the figure is
 * printed at whatever precision it actually carries, so the amount in the
 * message and the balance the distributor then opens cannot disagree. The
 * minimum of 2 keeps ₦1,500.50 from rendering as ₦1,500.5.
 */
function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
  })}`;
}

/**
 * P-5 — joins the admin's message to the allowance sentence.
 *
 * The spec's format is `[message]. Delivery allowance of [amount] has been
 * credited to your wallet.` A message the admin already ended with `.`, `!`
 * or `?` would otherwise produce a doubled stop, so an existing terminator is
 * kept as-is rather than having another appended.
 */
function joinSentence(message: string, next: string): string {
  const trimmed = message.trim();
  if (trimmed === '') return next;
  return /[.!?]$/.test(trimmed) ? `${trimmed} ${next}` : `${trimmed}. ${next}`;
}

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async sendRegional(adminId: string, dto: SendRegionalBroadcastDto) {
    const customers = await this.prisma.customer.findMany({
      where: { region: { in: dto.regions } },
      select: { id: true },
    });

    const reference = `BR-${Date.now().toString().slice(-6)}-Regional`;
    const broadcast = await this.prisma.broadcast.create({
      data: {
        reference,
        type: 'REGIONAL',
        message: dto.message,
        targetRegions: dto.regions,
        sentById: adminId,
        deliveredCount: customers.length,
      },
    });

    // P-3 — every distributor in each selected region, and the stored content
    // is the admin's text VERBATIM: no "Viju: " prefix, no decoration. The
    // admin composes the exact words in the broadcast form and cannot see
    // anything wrapped around them. `title`/`body` still shape the push, which
    // needs both fields.
    for (const c of customers) {
      await this.notifications.notify({
        recipientType: 'CUSTOMER',
        recipientId: c.id,
        title: 'Viju',
        body: dto.message,
        content: dto.message,
        type: NotificationTypes.BROADCAST,
        data: { broadcastId: broadcast.id },
      });
    }

    return broadcast;
  }

  /**
   * B-2 — an individual broadcast to one distributor or to several.
   *
   * `customerIds` and the original single `customerId` are both accepted; the
   * single form is simply a batch of one, so existing callers are unaffected
   * and there is only one code path to reason about.
   *
   * ALLOWANCE SEMANTICS, stated because the form promises them: the allowance
   * is credited PER RECIPIENT, never divided between them. Twelve recipients
   * at ₦1,000 credit ₦12,000 in total.
   *
   * Each recipient gets their OWN Broadcast row, so history stays
   * per-recipient and `deliveredCount` keeps meaning "how many people this
   * record reached". Sends run in sequence: each can credit a wallet, and a
   * burst of parallel payment writes is not something this route has been
   * asked to take.
   *
   * Returns the single broadcast when one recipient was named — byte-identical
   * to the old response — and the array when several were.
   */
  async sendIndividual(adminId: string, dto: SendIndividualBroadcastDto) {
    const ids = dto.customerIds ?? (dto.customerId ? [dto.customerId] : []);
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      throw new BadRequestException(
        'Provide customerId or a non-empty customerIds.',
      );
    }

    const sent: Awaited<ReturnType<typeof this.sendToOneCustomer>>[] = [];
    for (const customerId of unique) {
      sent.push(await this.sendToOneCustomer(adminId, customerId, dto));
    }
    // One recipient keeps the pre-B-2 response shape exactly.
    return unique.length === 1 ? sent[0] : sent;
  }

  /** One recipient's broadcast: wallet credit, record, notification. */
  private async sendToOneCustomer(
    adminId: string,
    customerId: string,
    dto: SendIndividualBroadcastDto,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
        region: true,
      },
    });
    if (!customer) throw new NotFoundException('Distributor not found');

    let allowancePaymentId: string | undefined;
    let creditedPayment: { amount: number; at: Date } | undefined;

    // PRD F15 AC5 + §8: delivery allowance reflects in wallet IMMEDIATELY,
    // not at next ERP sync. Write the Payment + bump Customer.outstandingBalance
    // in a single transaction.
    if (dto.deliveryAllowance && dto.deliveryAllowance > 0) {
      const allowance = dto.deliveryAllowance;
      const newBalance = customer.outstandingBalance + allowance;
      const result = await this.prisma.$transaction([
        this.prisma.customer.update({
          where: { id: customer.id },
          data: { outstandingBalance: newBalance },
        }),
        this.prisma.payment.create({
          data: {
            customerId: customer.id,
            date: new Date(),
            amount: allowance,
            reference: 'Delivery Allowance',
            runningBalance: newBalance,
          },
        }),
      ]);
      allowancePaymentId = result[1].id;
      // P-5 — the figure the distributor is told about is read back from the
      // Payment that was actually written, never echoed from the request. If
      // this transaction throws, the method throws with it and no notification
      // is sent, so a distributor is never told about a credit that failed.
      creditedPayment = { amount: result[1].amount, at: result[1].date };
    }

    const reference = `BR-${Date.now().toString().slice(-6)}-Individual`;
    const broadcast = await this.prisma.broadcast.create({
      data: {
        reference,
        type: 'INDIVIDUAL',
        message: dto.message,
        targetRegions: [customer.region],
        targetCustomerId: customer.id,
        deliveryAllowance: dto.deliveryAllowance ?? null,
        allowancePaymentId,
        sentById: adminId,
        deliveredCount: 1,
      },
    });

    // PRD F15 AC4 / P-4 / P-5 — the individual notification is prefixed with
    // the distributor's own name, unlike the regional one. That asymmetry is
    // the spec's wording and is reproduced verbatim rather than normalised.
    //
    // P-5 — when an allowance was credited, the sentence carries the amount
    // FROM THE PAYMENT ROW, formatted as currency and never rounded. The
    // wallet is credited in the transaction above, so the money is already
    // there by the time this notification is written: a distributor who opens
    // the app on the push sees the balance already updated.
    const text = creditedPayment
      ? `${customer.name}: ${joinSentence(
          dto.message,
          `Delivery allowance of ${formatNaira(creditedPayment.amount)} has been credited to your wallet.`,
        )}`
      : `${customer.name}: ${dto.message}`;

    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: customer.id,
      title: 'Viju',
      body: text,
      // No "Viju: " prefix — the stored content is exactly the spec's format.
      content: text,
      type: NotificationTypes.BROADCAST,
      data: {
        broadcastId: broadcast.id,
        ...(creditedPayment
          ? {
              allowanceAmount: String(creditedPayment.amount),
              creditedAt: creditedPayment.at.toISOString(),
            }
          : {}),
      },
    });

    return broadcast;
  }

  async listHistory(
    filter: BroadcastHistoryFilterDto,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const search = filter.search?.trim();
    const where = {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.region ? { targetRegions: { has: filter.region } } : {}),
      // B-1 — reference, message body, and the recipient (the target
      // customer's name on an individual broadcast). Server-side, so it
      // searches the whole history rather than the newest page of it, and
      // `meta.total` is the size of the filtered set.
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' as const } },
              { message: { contains: search, mode: 'insensitive' as const } },
              {
                targetCustomer: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
      ...(filter.startDate || filter.endDate
        ? {
            sentAt: {
              ...(filter.startDate ? { gte: new Date(filter.startDate) } : {}),
              ...(filter.endDate ? { lte: new Date(filter.endDate) } : {}),
            },
          }
        : {}),
    };
    return paginate(
      () => this.prisma.broadcast.count({ where }),
      (skip, take) =>
        this.prisma.broadcast.findMany({
          where,
          orderBy: { sentAt: 'desc' },
          include: {
            sentBy: { select: { name: true, email: true } },
            targetCustomer: { select: { id: true, name: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getDetail(id: string) {
    const broadcast = await this.prisma.broadcast.findUnique({
      where: { id },
      include: {
        sentBy: { select: { name: true, email: true } },
        targetCustomer: { select: { id: true, name: true } },
        allowancePayment: true,
      },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return broadcast;
  }
}
