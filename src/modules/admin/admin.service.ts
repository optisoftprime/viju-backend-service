import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ReassignOfficerDto, CreateOfficerDto } from './dto/admin.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats() {
    const totalCustomers = await this.prisma.customer.count();
    const totalOfficers = await this.prisma.staff.count({
      where: { role: 'OFFICER' },
    });
    const openTickets = await this.prisma.supportTicket.count({
      where: { status: 'OPEN' },
    });

    const customers = await this.prisma.customer.findMany({
      select: { outstandingBalance: true },
    });
    const totalOutstandingBalance = customers.reduce(
      (sum, c) => sum + (c.outstandingBalance || 0),
      0,
    );

    return {
      totalCustomers,
      totalOfficers,
      openTickets,
      totalOutstandingBalance,
    };
  }

  async getAllCustomers() {
    return this.prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        erpId: true,
        outstandingBalance: true,
        assignedOfficer: { select: { name: true, email: true } },
      },
    });
  }

  async reassignOfficer(customerId: string, dto: ReassignOfficerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const officer = await this.prisma.staff.findFirst({
      where: { id: dto.newOfficerId, role: 'OFFICER' },
    });
    if (!officer) throw new NotFoundException('Officer not found');

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { assignedOfficerId: dto.newOfficerId },
    });
  }

  async getOfficers() {
    return this.prisma.staff.findMany({
      where: { role: 'OFFICER' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        _count: { select: { customers: true } },
      },
    });
  }

  async createOfficer(dto: CreateOfficerDto) {
    const existing = await this.prisma.staff.findFirst({
      where: { email: dto.email },
    });
    if (existing) throw new BadRequestException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    return this.prisma.staff.create({
      data: {
        role: 'OFFICER',
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        region: dto.region,
        password: hashedPassword,
      },
      select: { id: true, name: true, email: true, phone: true, region: true },
    });
  }

  async deactivateOfficer(officerId: string) {
    const officer = await this.prisma.staff.findUnique({
      where: { id: officerId },
      include: { customers: true },
    });

    if (!officer) throw new NotFoundException('Officer not found');
    if (officer.customers.length > 0) {
      throw new BadRequestException(
        'Cannot deactivate officer. Please reassign their customers first.',
      );
    }

    return this.prisma.staff.update({
      where: { id: officerId },
      data: { isActive: false },
    });
  }
}
