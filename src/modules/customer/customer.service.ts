import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { UpdateProfilePhotoDto, ChangePasswordDto, PurchaseFilterDto } from './dto/customer.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        erpId: true,
        name: true,
        phone: true,
        accountStatus: true,
        outstandingBalance: true,
        profilePhotoUrl: true,
        assignedOfficer: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!customer) throw new NotFoundException('Customer profile not found');
    return customer;
  }

  async updatePhoto(customerId: string, dto: UpdateProfilePhotoDto) {
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { profilePhotoUrl: dto.photoUrl },
    });
  }

  async changePassword(customerId: string, dto: ChangePasswordDto) {
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: { password: hashedPassword },
    });
  }

  async getPurchases(customerId: string, filter: PurchaseFilterDto) {
    const where: any = { customerId };

    if (filter.search) {
      where.OR = [
        { erpId: { contains: filter.search, mode: 'insensitive' } },
        { items: { some: { productName: { contains: filter.search, mode: 'insensitive' } } } },
      ];
    }

    if (filter.startDate || filter.endDate) {
      where.orderDate = {};
      if (filter.startDate) where.orderDate.gte = new Date(filter.startDate);
      if (filter.endDate) where.orderDate.lte = new Date(filter.endDate);
    }

    return this.prisma.purchase.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      include: { items: true },
    });
  }

  async getPayments(customerId: string) {
    return this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { date: 'desc' },
    });
  }
}
