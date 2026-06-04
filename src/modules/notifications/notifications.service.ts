import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCustomer(customerId: string) {
    const items = await this.prisma.notification.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unread = items.filter((n) => !n.isRead).length;
    return { unread, items };
  }

  async listForStaff(staffId: string) {
    const items = await this.prisma.notification.findMany({
      where: { staffId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unread = items.filter((n) => !n.isRead).length;
    return { unread, items };
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
