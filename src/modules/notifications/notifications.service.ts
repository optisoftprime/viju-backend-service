import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate } from '../../common/pagination/paginate';
import { NotificationTypes } from '../../common/notifications/notification-types';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A distributor's own bell.
   *
   * N-1: `staffId: null` is load-bearing. A staff-bound row now carries the
   * distributor it concerns in `customerId` so the bell can deep-link to them,
   * and without this clause those rows - written FOR an officer, ABOUT this
   * customer - would surface in the customer's own feed.
   */
  async listForCustomer(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { customerId, staffId: null };
    const [unread, page] = await Promise.all([
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
      paginate(
        () => this.prisma.notification.count({ where }),
        (skip, take) =>
          this.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
          }),
        pagination,
      ),
    ]);
    return { unread, ...page };
  }

  /**
   * The staff bell.
   *
   * NB-1 — `CHAT_MESSAGE` rows are EXCLUDED. The staff portal already says
   * "you have unread chat" twice: the unread badge on the Chat sidebar entry
   * and the per-conversation count. A third copy in the notification panel
   * buried the things that only appear there — assignments, tickets, waybill
   * movements.
   *
   * Filtered on READ rather than by not writing the row, deliberately:
   *
   *   • `unread` and `data` are then filtered by the SAME predicate, so the
   *     bell count matches the list exactly. That is the actual bug — the
   *     panel is paginated, so a client-side filter forced the badge to be
   *     recounted from one page and it under-reported past the first.
   *   • The row is still written, so the push dispatch and the realtime frame
   *     are untouched, and nothing is lost if this is ever reversed.
   *
   * THE DISTRIBUTOR'S OWN FEED IS UNCHANGED — see `listForCustomer`, which has
   * no such exclusion. This is a staff-portal concern only; the mobile app has
   * no badge to replace them with.
   */
  async listForStaff(
    staffId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = {
      staffId,
      type: { not: NotificationTypes.CHAT_MESSAGE },
    };
    const [unread, page] = await Promise.all([
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
      paginate(
        () => this.prisma.notification.count({ where }),
        (skip, take) =>
          this.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
          }),
        pagination,
      ),
    ]);
    return { unread, ...page };
  }

  async markRead(userType: 'CUSTOMER' | 'STAFF', userId: string, id: string) {
    // Same N-1 rule as listForCustomer: a customer may only act on their own
    // rows, never on a staff row that merely names them.
    const where =
      userType === 'CUSTOMER'
        ? { id, customerId: userId, staffId: null }
        : { id, staffId: userId };
    const existing = await this.prisma.notification.findFirst({ where });
    if (!existing) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  /**
   * NB-1 — "mark all read" clears what the caller can SEE.
   *
   * For staff that excludes CHAT_MESSAGE, matching `listForStaff`. Clearing
   * rows the bell never showed would be a hidden side effect, and those rows
   * are read by opening the conversation instead.
   */
  async markAllRead(userType: 'CUSTOMER' | 'STAFF', userId: string) {
    const where =
      userType === 'CUSTOMER'
        ? { customerId: userId, staffId: null }
        : { staffId: userId, type: { not: NotificationTypes.CHAT_MESSAGE } };
    await this.prisma.notification.updateMany({
      where: { ...where, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }
}
