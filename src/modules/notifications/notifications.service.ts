import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate } from '../../common/pagination/paginate';

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

  async listForStaff(
    staffId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { staffId };
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

  async markAllRead(userType: 'CUSTOMER' | 'STAFF', userId: string) {
    const where =
      userType === 'CUSTOMER'
        ? { customerId: userId, staffId: null }
        : { staffId: userId };
    await this.prisma.notification.updateMany({
      where: { ...where, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }
}
