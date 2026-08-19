import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { paginate } from '../../common/pagination/paginate';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCustomer(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { customerId };
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
    const where =
      userType === 'CUSTOMER'
        ? { id, customerId: userId }
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
      userType === 'CUSTOMER' ? { customerId: userId } : { staffId: userId };
    await this.prisma.notification.updateMany({
      where: { ...where, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  }
}
