import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class OfficerService {
  constructor(private readonly prisma: PrismaService) {}

  async getAssignedCustomers(officerId: string) {
    return this.prisma.customer.findMany({
      where: { assignedOfficerId: officerId },
      select: {
        id: true,
        name: true,
        erpId: true,
        outstandingBalance: true,
        accountStatus: true,
        _count: {
          select: { supportTickets: { where: { status: 'OPEN' } } },
        },
      },
    });
  }

  async getCustomerDetail(officerId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, assignedOfficerId: officerId },
      include: {
        purchases: { orderBy: { orderDate: 'desc' }, include: { items: true } },
        payments: { orderBy: { date: 'desc' } },
        supportTickets: true,
      },
    });

    if (!customer)
      throw new NotFoundException('Customer not found or not assigned to you');
    return customer;
  }

  async getStock() {
    return this.prisma.stock.findMany();
  }
}
