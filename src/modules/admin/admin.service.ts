import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { EmailService } from '../../infrastructure/email/email.types';
import {
  ReassignOfficerDto,
  CreateOfficerDto,
  CreateTestCustomerDto,
  CreateProductFlyerDto,
  UpdateProductFlyerDto,
  ReorderProductFlyersDto,
} from './dto/admin.dto';
import * as bcrypt from 'bcryptjs';
import { paginate } from '../../common/pagination/paginate';

@Injectable()
export class AdminService {
  private readonly logger = new Logger('AdminService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
  ) {}

  async getDashboardStats() {
    const REGIONS = ['LAGOS', 'SOUTH_WEST', 'SOUTH_EAST', 'NORTH'] as const;

    const [
      totalCustomers,
      unReadMessage,
      openTickets,
      activeOfficers,
      customers,
      perRegionCustomers,
      perRegionTicketsByCustomer,
      perRegionOfficers,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.message.count({
        where: { senderType: 'CUSTOMER', readAt: null },
      }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.staff.count({ where: { role: 'OFFICER', isActive: true } }),
      this.prisma.customer.findMany({
        select: { id: true, region: true, outstandingBalance: true },
      }),
      this.prisma.customer.groupBy({
        by: ['region'],
        _count: { _all: true },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['customerId'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
      this.prisma.staff.groupBy({
        by: ['region'],
        where: { role: 'OFFICER', isActive: true, region: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const totalOutstandingBalance = customers.reduce(
      (sum, c) => sum + (c.outstandingBalance || 0),
      0,
    );

    const customerCountByRegion = new Map(
      perRegionCustomers.map((r) => [r.region, r._count._all]),
    );
    const officerCountByRegion = new Map(
      perRegionOfficers.map((r) => [r.region as string, r._count._all]),
    );
    const walletByRegion = new Map<string, number>();
    const customerRegionLookup = new Map<string, string>();
    for (const c of customers) {
      walletByRegion.set(
        c.region,
        (walletByRegion.get(c.region) ?? 0) + (c.outstandingBalance || 0),
      );
      customerRegionLookup.set(c.id, c.region);
    }
    const ticketsByRegion = new Map<string, number>();
    for (const t of perRegionTicketsByCustomer) {
      const region = customerRegionLookup.get(t.customerId);
      if (!region) continue;
      ticketsByRegion.set(
        region,
        (ticketsByRegion.get(region) ?? 0) + t._count._all,
      );
    }

    const byRegion = REGIONS.map((region) => ({
      region,
      distributors: customerCountByRegion.get(region) ?? 0,
      walletBalance: walletByRegion.get(region) ?? 0,
      openTickets: ticketsByRegion.get(region) ?? 0,
      activeOfficers: officerCountByRegion.get(region) ?? 0,
    }));

    return {
      totalCustomers,
      totalOutstandingBalance,
      activeOfficers,
      openTickets,
      unReadMessage,
      byRegion,
    };
  }

  private buildCustomerWhere(filter?: {
    region?: 'LAGOS' | 'SOUTH_WEST' | 'SOUTH_EAST' | 'NORTH';
    search?: string;
  }) {
    return {
      ...(filter?.region ? { region: filter.region } : {}),
      ...(filter?.search
        ? {
            OR: [
              {
                name: { contains: filter.search, mode: 'insensitive' as const },
              },
              {
                erpId: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
  }

  async getAllCustomers(
    filter: {
      region?: 'LAGOS' | 'SOUTH_WEST' | 'SOUTH_EAST' | 'NORTH';
      search?: string;
    } = {},
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = this.buildCustomerWhere(filter);
    return paginate(
      () => this.prisma.customer.count({ where }),
      (skip, take) =>
        this.prisma.customer.findMany({
          where,
          select: {
            id: true,
            name: true,
            erpId: true,
            phone: true,
            region: true,
            accountStatus: true,
            outstandingBalance: true,
            _count: {
              select: { supportTickets: { where: { status: 'OPEN' } } },
            },
            officerAssignments: {
              select: {
                staff: { select: { id: true, name: true, email: true } },
              },
            },
          },
          orderBy: { erpId: 'asc' },
          skip,
          take,
        }),
      pagination,
    );
  }

  async exportCustomersCsv(filter?: {
    region?: 'LAGOS' | 'SOUTH_WEST' | 'SOUTH_EAST' | 'NORTH';
    search?: string;
  }): Promise<string> {
    const where = this.buildCustomerWhere(filter);
    const rows = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        erpId: true,
        phone: true,
        region: true,
        accountStatus: true,
        outstandingBalance: true,
        _count: {
          select: { supportTickets: { where: { status: 'OPEN' } } },
        },
        officerAssignments: {
          select: { staff: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { erpId: 'asc' },
    });
    const header = [
      'erpId',
      'name',
      'phone',
      'region',
      'accountStatus',
      'outstandingBalance',
      'openTickets',
      'assignedOfficers',
    ].join(',');
    const lines = rows.map((c) =>
      [
        this.csv(c.erpId),
        this.csv(c.name),
        this.csv(c.phone),
        c.region,
        c.accountStatus,
        c.outstandingBalance,
        c._count.supportTickets,
        this.csv(
          c.officerAssignments.map((a) => a.staff.name).join(' / ') || '',
        ),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  private csv(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  async reassignOfficer(customerId: string, dto: ReassignOfficerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // PRD F16 AC2: new officer must be active and in the SAME region
    const officer = await this.prisma.staff.findFirst({
      where: {
        id: dto.newOfficerId,
        role: 'OFFICER',
        isActive: true,
        region: customer.region,
      },
    });
    if (!officer)
      throw new BadRequestException(
        'New officer must be active and in the same region as the customer.',
      );

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: { assignedOfficerId: dto.newOfficerId },
    });

    // PRD §6 — notify the new officer
    await this.notifications.notify({
      recipientType: 'STAFF',
      recipientId: dto.newOfficerId,
      title: 'Customer assigned',
      body: `${customer.name} has been assigned to you`,
      type: 'CUSTOMER_REASSIGNED',
      data: { customerId },
    });

    return updated;
  }

  async getOfficers(
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { role: 'OFFICER' as const };
    return paginate(
      () => this.prisma.staff.count({ where }),
      (skip, take) =>
        this.prisma.staff.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            region: true,
            isActive: true,
            _count: { select: { customers: true } },
          },
          orderBy: { name: 'asc' },
          skip,
          take,
        }),
      pagination,
    );
  }

  async createOfficer(dto: CreateOfficerDto) {
    const existing = await this.prisma.staff.findFirst({
      where: { email: dto.email },
    });
    if (existing) throw new BadRequestException('Email already in use');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const officer = await this.prisma.staff.create({
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

    // PRD F18 AC4 — email the new officer their login credentials.
    // Provider impls already wrap their own sends in try/catch, but we
    // double-wrap here as a defensive net: officer creation must succeed
    // even if email is misconfigured or a future provider impl regresses
    // and starts throwing. The officer record + response are the source
    // of truth; the welcome email is a nice-to-have.
    try {
      await this.email.send({
        to: dto.email,
        subject: 'Welcome to Viju Account Officer Portal',
        body: [
          `Hello ${dto.name},`,
          '',
          'An account has been created for you on the Viju Account Officer Portal.',
          '',
          `Email:    ${dto.email}`,
          `Region:   ${dto.region ?? '—'}`,
          `Password: ${dto.password}`,
          '',
          'Please log in and change your password as soon as possible.',
          '',
          'Viju Team',
        ].join('\n'),
      });
    } catch (e) {
      this.logger.error(
        `Welcome email failed for ${dto.email} — ${(e as Error).message}. ` +
          'Officer record was still created successfully.',
      );
    }

    return officer;
  }

  async createTestCustomer(dto: CreateTestCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { phone: dto.phone },
    });
    if (existing) {
      throw new BadRequestException(
        'A customer with that phone number already exists.',
      );
    }

    // Treat empty / whitespace / Swagger's placeholder "string" as missing
    // so a usable MOCK- ID is generated. PRD F8 sync will overwrite these
    // once ERP customer-sync lands.
    const provided = dto.erpId?.trim();
    const erpId =
      provided && provided !== 'string' ? provided : `MOCK-${Date.now()}`;
    return this.prisma.customer.create({
      data: {
        erpId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        region: dto.region,
      },
      select: {
        id: true,
        erpId: true,
        name: true,
        phone: true,
        email: true,
        region: true,
      },
    });
  }

  // ─── Product Flyer (PRD F19) ────────────────────────────
  async listProductFlyers() {
    return this.prisma.productFlyer.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createProductFlyer(dto: CreateProductFlyerDto, adminId: string) {
    const max = await this.prisma.productFlyer.aggregate({
      _max: { sortOrder: true },
    });
    return this.prisma.productFlyer.create({
      data: {
        name: dto.name,
        imageUrl: dto.imageUrl,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        createdById: adminId,
      },
    });
  }

  async updateProductFlyer(id: string, dto: UpdateProductFlyerDto) {
    const existing = await this.prisma.productFlyer.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Product flyer not found');
    return this.prisma.productFlyer.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        imageUrl: dto.imageUrl ?? existing.imageUrl,
        isActive: dto.isActive ?? existing.isActive,
      },
    });
  }

  async deleteProductFlyer(id: string) {
    const existing = await this.prisma.productFlyer.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Product flyer not found');
    await this.prisma.productFlyer.delete({ where: { id } });
  }

  async reorderProductFlyers(dto: ReorderProductFlyersDto) {
    const flyers = await this.prisma.productFlyer.findMany({
      where: { id: { in: dto.orderedIds } },
      select: { id: true },
    });
    if (flyers.length !== dto.orderedIds.length) {
      throw new BadRequestException('One or more flyer IDs are invalid.');
    }
    await Promise.all(
      dto.orderedIds.map((id, index) =>
        this.prisma.productFlyer.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.listProductFlyers();
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
