import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import { Prisma, StaffRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ErpRawService } from '../../infrastructure/erp-raw/erp-raw.service';
import { DefaultOfficerService } from '../erp/default-officer.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { EmailService } from '../../infrastructure/email/email.types';
import {
  ReassignOfficerDto,
  CreateOfficerDto,
  CreateTestCustomerDto,
  CreateProductFlyerDto,
  UpdateProductFlyerDto,
  ReorderProductFlyersDto,
  CustomerSortField,
  OfficerSortField,
} from './dto/admin.dto';
import * as bcrypt from 'bcryptjs';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { Region, REGION_VALUES } from '../../common/region/region.constants';
import {
  CREATABLE_STAFF_ROLE_VALUES,
  MANAGED_STAFF_ROLES,
  isManagedStaffRole,
  normalizeManagedRole,
  requiresRegion,
} from '../../common/roles/managed-roles';
import {
  MAX_PAGE_SIZE,
  buildPaginationMeta,
  paginate,
  paginateInMemory,
} from '../../common/pagination/paginate';
import {
  SortOrder,
  compareBy,
  sortDirection,
} from '../../common/pagination/sort.dto';

/** Filter + sort options shared by the customer list and its CSV export. */
interface CustomerListFilter {
  region?: Region;
  search?: string;
  sortBy?: CustomerSortField;
  sortOrder?: SortOrder;
  /** B-1.1 — true: only assigned customers; false: only unassigned. */
  hasOfficer?: boolean;
  /**
   * When true the result set is the union of projected customers and ERP-feed
   * customers not yet projected. Default false — existing callers are
   * unaffected.
   */
  includeUnprojected?: boolean;
}

interface OfficerListFilter {
  region?: Region;
  search?: string;
  role?: StaffRole;
  /** When true, lists every internally managed role instead of one. */
  managed?: boolean;
  /** Filter on account status; omit for both. */
  isActive?: boolean;
  sortBy?: OfficerSortField;
  sortOrder?: SortOrder;
}

/**
 * The authenticated ADMIN behind a management call, resolved from the JWT by
 * the controller — never from the request body (CC-01). `id` is null only in
 * legacy/internal call sites that have no actor to record.
 */
export interface AdminActor {
  id: string | null;
}

/** Human-facing role names for the welcome email. */
const MANAGED_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'an Administrator',
  REGIONAL_ADMIN: 'a Regional Admin',
  OFFICER: 'an Account Officer',
  LOADING_OFFICER: 'a Loading Officer',
};

@Injectable()
export class AdminService {
  private readonly logger = new Logger('AdminService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
    private readonly erpRaw: ErpRawService,
    private readonly defaultOfficer: DefaultOfficerService,
  ) {}

  async getDashboardStats() {
    const [
      syncedCustomers,
      unReadMessage,
      openTickets,
      activeOfficers,
      customers,
      perRegionCustomers,
      perRegionTicketsByCustomer,
      perRegionOfficers,
      activeCustomers,
      customersWithoutOfficer,
      erpCounts,
      erpSync,
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
      this.prisma.customer.count({ where: { accountStatus: 'ACTIVE' } }),
      this.prisma.customer.count({ where: { assignedOfficerId: null } }),
      this.erpRaw.getCustomerCounts(),
      this.erpRaw.getSyncStatus(),
    ]);

    // B-1.2 — the headline tile must show what the ERP holds, not how many
    // rows the projector has copied across so far. When the ERP feed is not
    // attached (a fresh database, CI) fall back to the local count so the tile
    // still renders a number rather than nothing.
    const erpAvailable = erpCounts.erpTotal > 0;
    const totalCustomers = erpAvailable ? erpCounts.vijuTotal : syncedCustomers;

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

    const byRegion = REGION_VALUES.map((region) => {
      const distCount = customerCountByRegion.get(region) ?? 0;
      return {
        region: { name: region, dist: distCount },
        distributors: distCount,
        walletBalance: walletByRegion.get(region) ?? 0,
        openTickets: ticketsByRegion.get(region) ?? 0,
        activeOfficers: officerCountByRegion.get(region) ?? 0,
      };
    });

    return {
      totalCustomers,
      totalActiveCustomers: activeCustomers,
      customersWithoutOfficer,
      totalOutstandingBalance,
      activeOfficers,
      openTickets,
      unReadMessage,
      lastErpSyncAt: erpCounts.lastSyncAt ?? erpSync.lastSyncAt,
      // B-2.3 — ERP rows whose region does not map to a Viju region. Surfaced
      // so the mismatch is visible instead of silently dropped.
      unmappedRegionCount: erpCounts.unmappedRegionCount,
      erpReconciliation: {
        source: erpAvailable ? ('ERP' as const) : ('LOCAL' as const),
        erpTotal: erpCounts.erpTotal,
        vijuTotal: erpCounts.vijuTotal,
        syncedTotal: syncedCustomers,
        awaitingProjection: Math.max(0, erpCounts.vijuTotal - syncedCustomers),
        unmappedRegionCount: erpCounts.unmappedRegionCount,
        lastSyncAt: erpCounts.lastSyncAt,
      },
      byRegion,
    };
  }

  /**
   * B-2.3 — the ERP customer rows whose BP_CLUSTER_CODE does not map to a Viju
   * region. Read-only quarantine listing so ops can chase the ERP team with
   * specific codes instead of a bare count.
   */
  async listUnmappedErpCustomers(pagination: {
    page: number;
    pageSize: number;
  }) {
    const { rows, total } = await this.erpRaw.listUnmappedCustomers(pagination);
    return {
      data: rows,
      meta: buildPaginationMeta(total, pagination.page, pagination.pageSize),
    };
  }

  /** Ingest / projection freshness, for the ERP status panel. */
  async getErpSyncStatus() {
    const [status, counts] = await Promise.all([
      this.erpRaw.getSyncStatus(),
      this.erpRaw.getCustomerCounts(),
    ]);
    return {
      available: await this.erpRaw.isAvailable(),
      lastSyncAt: status.lastSyncAt,
      customers: {
        erpTotal: counts.erpTotal,
        vijuTotal: counts.vijuTotal,
        unmappedRegionCount: counts.unmappedRegionCount,
        byRegion: counts.byRegion,
      },
      jobs: status.jobs,
    };
  }

  private buildCustomerWhere(filter?: CustomerListFilter) {
    return {
      ...(filter?.region ? { region: filter.region } : {}),
      ...(filter?.hasOfficer === undefined
        ? {}
        : filter.hasOfficer
          ? { assignedOfficerId: { not: null } }
          : { assignedOfficerId: null }),
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

  /** Columns of GET /admin/customers that map straight onto a Prisma orderBy. */
  private customerOrderBy(
    sortBy: CustomerSortField | undefined,
    sortOrder?: SortOrder,
  ): Prisma.CustomerOrderByWithRelationInput {
    // Default (no sortBy) must reproduce today's ordering exactly so callers
    // that don't sort see no change (US-09.3).
    if (!sortBy) return { erpId: 'asc' };
    const direction = sortDirection(sortOrder);
    switch (sortBy) {
      case 'name':
        return { name: direction };
      case 'erpId':
        return { erpId: direction };
      case 'region':
        return { region: direction };
      case 'outstandingBalance':
        return { outstandingBalance: direction };
      case 'createdAt':
        return { createdAt: direction };
      default:
        // supportTickets is a filtered relation count — see getAllCustomers.
        return { erpId: 'asc' };
    }
  }

  private readonly customerListSelect = {
    id: true,
    name: true,
    erpId: true,
    phone: true,
    region: true,
    accountStatus: true,
    outstandingBalance: true,
    assignedOfficerId: true,
    createdAt: true,
    _count: {
      select: { supportTickets: { where: { status: 'OPEN' as const } } },
    },
    officerAssignments: {
      select: {
        staff: { select: { id: true, name: true, email: true } },
      },
    },
  };

  async getAllCustomers(
    filter: CustomerListFilter = {},
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    if (filter.includeUnprojected) {
      return this.getAllCustomersIncludingUnprojected(filter, pagination);
    }
    return this.getProjectedCustomers(filter, pagination);
  }

  /**
   * The union view (FE request 3.2 A).
   *
   * The dashboard tile counts what the ERP has (1,851 today); this endpoint
   * could only page through what the projector has copied across (4). With
   * `includeUnprojected=true` the two agree: `meta.total` is the size of the
   * union, so paging stays arithmetically correct, and every row carries
   * `isProjected` so the client can grey out the ones with no local record.
   *
   * Ordering is projected rows first — in whatever order `sortBy` asked for —
   * then unprojected rows by erpId. The two sides have different columns
   * available (an ERP row has no balance or ticket count), so a single merged
   * sort would be sorting on values that only exist for half the set. Blocking
   * them keeps every page deterministic.
   *
   * This is a stopgap for a projector that is not copying rows; see
   * `getErpSyncDiagnostics`. Once projection runs, `unprojectedTotal` reaches
   * zero and this mode returns exactly what the default mode returns.
   */
  private async getAllCustomersIncludingUnprojected(
    filter: CustomerListFilter,
    pagination: { page: number; pageSize: number },
  ) {
    const page = Math.max(1, Math.floor(pagination.page || 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(pagination.pageSize || 20)),
    );
    const offset = (page - 1) * pageSize;

    // An unprojected row has no officer by definition, so `hasOfficer=true`
    // excludes the whole ERP-only side rather than filtering it row by row.
    const erpFilter = { region: filter.region, search: filter.search };
    const wantsUnprojected = filter.hasOfficer !== true;

    const [projectedTotal, unprojectedTotal] = await Promise.all([
      this.prisma.customer.count({ where: this.buildCustomerWhere(filter) }),
      wantsUnprojected
        ? this.erpRaw.countUnprojectedCustomers(erpFilter)
        : Promise.resolve(0),
    ]);

    // Split this page across the two blocks.
    const takeProjected = Math.max(
      0,
      Math.min(pageSize, projectedTotal - offset),
    );
    const takeUnprojected = Math.max(0, pageSize - takeProjected);
    const skipUnprojected = Math.max(0, offset - projectedTotal);

    const [projectedRows, unprojectedRows] = await Promise.all([
      takeProjected > 0
        ? this.getProjectedCustomerSlice(filter, offset, takeProjected)
        : Promise.resolve([]),
      takeUnprojected > 0 && wantsUnprojected
        ? this.erpRaw.listUnprojectedCustomers(erpFilter, {
            skip: skipUnprojected,
            take: takeUnprojected,
          })
        : Promise.resolve([]),
    ]);

    const total = projectedTotal + unprojectedTotal;
    return {
      data: [
        ...projectedRows,
        ...unprojectedRows.map((r) => ({
          // No local record exists yet, so there is no id to return.
          id: null,
          erpId: r.erpId,
          name: r.name,
          phone: r.phone,
          region: r.region,
          accountStatus: null,
          outstandingBalance: null,
          stockBalanceCartons: null,
          assignedOfficerId: null,
          hasOfficer: false,
          officerAssignments: [],
          _count: { supportTickets: 0 },
          createdAt: null,
          lastSyncedAt: r.lastSeenAt,
          isProjected: false,
        })),
      ],
      meta: {
        ...buildPaginationMeta(total, page, pageSize),
        projectedTotal,
        unprojectedTotal,
      },
    };
  }

  /** The projected-only listing — unchanged behaviour, the default path. */
  private async getProjectedCustomers(
    filter: CustomerListFilter = {},
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = this.buildCustomerWhere(filter);

    // `supportTickets` is a COUNT of OPEN tickets only. Prisma can order by a
    // relation count but not by a *filtered* one, so ordering it in SQL would
    // sort by a different number than the column the table displays. Sort it
    // in memory instead — same rows, same count, consistent ordering.
    if (filter.sortBy === 'supportTickets') {
      const rows = await this.prisma.customer.findMany({
        where,
        select: this.customerListSelect,
        orderBy: { erpId: 'asc' },
      });
      rows.sort(
        compareBy(
          (c) => c._count.supportTickets,
          sortDirection(filter.sortOrder),
        ),
      );
      const inMemory = paginateInMemory(rows, pagination);
      return {
        data: await this.withErpColumns(inMemory.data),
        meta: inMemory.meta,
      };
    }

    const orderBy = this.customerOrderBy(filter.sortBy, filter.sortOrder);
    const page = await paginate(
      () => this.prisma.customer.count({ where }),
      (skip, take) =>
        this.prisma.customer.findMany({
          where,
          select: this.customerListSelect,
          orderBy,
          skip,
          take,
        }),
      pagination,
    );
    return { data: await this.withErpColumns(page.data), meta: page.meta };
  }

  /**
   * `take` projected rows starting at absolute offset `skip`, honouring the
   * same filter and sort as the default listing. Used by the union view to
   * fill the projected half of a page.
   */
  private async getProjectedCustomerSlice(
    filter: CustomerListFilter,
    skip: number,
    take: number,
  ) {
    const where = this.buildCustomerWhere(filter);

    // Mirrors getProjectedCustomers: a filtered relation count cannot be
    // ordered in SQL, so that one column sorts in memory.
    if (filter.sortBy === 'supportTickets') {
      const rows = await this.prisma.customer.findMany({
        where,
        select: this.customerListSelect,
        orderBy: { erpId: 'asc' },
      });
      rows.sort(
        compareBy(
          (c) => c._count.supportTickets,
          sortDirection(filter.sortOrder),
        ),
      );
      return this.withErpColumns(rows.slice(skip, skip + take));
    }

    const rows = await this.prisma.customer.findMany({
      where,
      select: this.customerListSelect,
      orderBy: this.customerOrderBy(filter.sortBy, filter.sortOrder),
      skip,
      take,
    });
    return this.withErpColumns(rows);
  }

  /**
   * Adds the two ERP-derived columns the customer table needs (B-1.1):
   *
   * - `stockBalanceCartons` — cartons paid for but not yet loaded, i.e.
   *   ordered minus completed loading requests, floored at zero.
   * - `lastSyncedAt` — when the ERP last reported this customer, read from the
   *   ERP feed rather than a local column, so it reflects the ERP and not the
   *   projector that writes our rows.
   *
   * Both are computed for the page slice only: two aggregates plus one small
   * feed lookup, regardless of page size.
   */
  private async withErpColumns<
    T extends { id: string; erpId: string; assignedOfficerId?: string | null },
  >(rows: T[]) {
    if (rows.length === 0) return [];
    const customerIds = rows.map((r) => r.id);

    const [orderedRows, loadedRows, lastSeen] = await Promise.all([
      this.prisma.$queryRaw<{ customerId: string; qty: number }[]>`
        SELECT p."customerId" AS "customerId",
               COALESCE(SUM(i.quantity), 0)::int AS qty
          FROM "PurchaseItem" i
          JOIN "Purchase" p ON p.id = i."purchaseId"
         WHERE p."customerId" = ANY(${customerIds})
         GROUP BY 1`,
      this.prisma.loadingRequest.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: 'COMPLETED' },
        _sum: { quantityCartons: true },
      }),
      this.erpRaw.getLastSeenByErpIds(rows.map((r) => r.erpId)),
    ]);

    const ordered = new Map(orderedRows.map((r) => [r.customerId, r.qty]));
    const loaded = new Map(
      loadedRows.map((r) => [r.customerId, r._sum.quantityCartons ?? 0]),
    );

    return rows.map((row) => ({
      ...row,
      hasOfficer: row.assignedOfficerId != null,
      stockBalanceCartons: Math.max(
        0,
        (ordered.get(row.id) ?? 0) - (loaded.get(row.id) ?? 0),
      ),
      lastSyncedAt: lastSeen.get(row.erpId) ?? null,
      isProjected: true,
    }));
  }

  /**
   * B-3 — one customer, at ERP parity.
   *
   * Combines what we hold locally with what the ERP feed reports for the same
   * erpId (credit limit, ERP freshness). Every optional field is returned as
   * an explicit null rather than omitted, so the client never has to
   * distinguish "absent" from "unknown".
   *
   * `address` is always null today: the ERP customer master has no address
   * field. See ErpRawService.getCustomerDetail for what it would take.
   */
  async getCustomerDetail(
    customerId: string,
    viewer: { role: string; region?: Region | null },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        erpId: true,
        name: true,
        phone: true,
        email: true,
        region: true,
        accountStatus: true,
        outstandingBalance: true,
        assignedOfficerId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { supportTickets: { where: { status: 'OPEN' } } },
        },
        officerAssignments: {
          select: {
            id: true,
            isPrimary: true,
            assignedAt: true,
            staff: { select: { id: true, name: true, email: true } },
          },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // A regional admin may only open a customer inside their own region.
    if (
      viewer.role === 'REGIONAL_ADMIN' &&
      customer.region !== (viewer.region ?? null)
    ) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }

    const [enriched] = await this.withErpColumns([customer]);
    const erp = await this.erpRaw.getCustomerDetail(customer.erpId);

    return {
      id: customer.id,
      erpId: customer.erpId,
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? null,
      address: erp?.address ?? null,
      region: customer.region,
      isActive: customer.accountStatus === 'ACTIVE',
      accountStatus: customer.accountStatus,
      outstandingBalance: customer.outstandingBalance,
      stockBalanceCartons: enriched.stockBalanceCartons,
      creditLimit: erp?.creditLimit ?? null,
      officerAssignments: customer.officerAssignments.map((a) => ({
        id: a.id,
        isPrimary: a.isPrimary,
        assignedAt: a.assignedAt,
        staff: a.staff,
      })),
      _count: { supportTickets: customer._count.supportTickets },
      lastErpSyncAt: erp?.lastErpSyncAt ?? enriched.lastSyncedAt ?? null,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  async exportCustomersCsv(filter?: {
    region?: Region;
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

  /**
   * AD-R1 - assigns a customer to an account officer, whether or not they
   * already have one.
   *
   * Works for a customer with an EMPTY `officerAssignments[]`: the join row is
   * upserted rather than moved, so a first assignment and a reassignment take
   * the same path. Both cases notify the incoming officer - bell row plus web
   * push, via NotificationService.notify.
   *
   * Errors carry a machine-readable `code` the client branches on:
   * CUSTOMER_NOT_FOUND (404), OFFICER_NOT_FOUND (400), ALREADY_ASSIGNED (409).
   */
  async reassignOfficer(customerId: string, dto: ReassignOfficerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer)
      throw new NotFoundException({
        message: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND',
        statusCode: HttpStatus.NOT_FOUND,
      });

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
      throw new BadRequestException({
        message: 'Officer not found or inactive',
        code: 'OFFICER_NOT_FOUND',
        statusCode: HttpStatus.BAD_REQUEST,
      });

    // Re-sending the assignment the customer already has is a no-op the
    // client would otherwise read as success and re-render from - it is
    // refused so the operator sees why nothing changed.
    if (customer.assignedOfficerId === dto.newOfficerId) {
      throw new ConflictException({
        message: `${officer.name} is already assigned to this customer`,
        code: 'ALREADY_ASSIGNED',
        statusCode: HttpStatus.CONFLICT,
      });
    }

    await this.repointAssignment(
      customerId,
      customer.assignedOfficerId,
      dto.newOfficerId,
    );

    // US-13.4 / AD-R1 - the RECEIVING officer must see this in their bell and
    // on their device, on a first assignment as well as a reassignment.
    await this.notifications.notify({
      recipientType: 'STAFF',
      recipientId: dto.newOfficerId,
      title: 'Customer assigned',
      body: `${customer.name} has been assigned to you`,
      type: NotificationTypes.ASSIGNMENT,
      data: { customerId },
    });

    // The resulting assignments, so the OFFICERS cell refreshes without a
    // second round trip.
    const officerAssignments = await this.prisma.customerOfficer.findMany({
      where: { customerId },
      orderBy: { isPrimary: 'desc' },
      select: {
        id: true,
        isPrimary: true,
        assignedAt: true,
        staff: { select: { id: true, name: true, email: true } },
      },
    });

    return {
      message: 'Customer assigned successfully',
      customerId,
      officerAssignments,
    };
  }

  /** Columns of GET /admin/officers that map straight onto a Prisma orderBy. */
  private officerOrderBy(
    sortBy: OfficerSortField | undefined,
    sortOrder?: SortOrder,
  ): Prisma.StaffOrderByWithRelationInput {
    // Default (no sortBy) reproduces today's ordering exactly (US-09.3).
    if (!sortBy) return { name: 'asc' };
    const direction = sortDirection(sortOrder);
    switch (sortBy) {
      case 'name':
        return { name: direction };
      case 'email':
        return { email: direction };
      case 'region':
        return { region: direction };
      case 'createdAt':
        return { createdAt: direction };
      case 'lastLoginAt':
        return { lastLoginAt: direction };
      case 'customers':
        return { customers: { _count: direction } };
      default:
        // supportTickets is derived — see getOfficers.
        return { name: 'asc' };
    }
  }

  private readonly officerListSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    region: true,
    // The list now backs every internally managed role, not just OFFICER, so
    // the row has to say which one it is.
    role: true,
    isActive: true,
    createdAt: true,
    // US-15.1: the officer list shows 'last login', so it has to be returned
    // rather than the FE substituting createdAt for it.
    lastLoginAt: true,
    // Audit trail (PRD 12) — when the account was last retired / restored.
    deactivatedAt: true,
    reactivatedAt: true,
    _count: { select: { customers: true } },
  };

  /** Row shape returned by POST /admin/officers. */
  private readonly createdOfficerSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    region: true,
    role: true,
    isActive: true,
    createdAt: true,
    createdById: true,
  };

  /** Row shape returned by PATCH /admin/officers/:id. */
  private readonly officerStatusSelect = {
    id: true,
    name: true,
    email: true,
    phone: true,
    region: true,
    role: true,
    isActive: true,
    deactivatedAt: true,
    deactivatedById: true,
    reactivatedAt: true,
    reactivatedById: true,
    updatedAt: true,
  };

  /**
   * Open support tickets across each officer's customers, keyed by officer id
   * (US-15.1). Not expressible as a Prisma relation count on Staff — tickets
   * hang off Customer — so it is one grouped query over the officers in play.
   */
  private async openTicketsByOfficer(
    officerIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (officerIds.length === 0) return counts;

    const rows = await this.prisma.customer.findMany({
      where: { assignedOfficerId: { in: officerIds } },
      select: {
        assignedOfficerId: true,
        _count: { select: { supportTickets: { where: { status: 'OPEN' } } } },
      },
    });
    for (const row of rows) {
      if (!row.assignedOfficerId) continue;
      counts.set(
        row.assignedOfficerId,
        (counts.get(row.assignedOfficerId) ?? 0) + row._count.supportTickets,
      );
    }
    return counts;
  }

  async getOfficers(
    filter: OfficerListFilter = {},
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where: Prisma.StaffWhereInput = {
      // RA-06: the same route backs the loading-officer picker, so the role
      // is a parameter. Defaults to OFFICER, which is what it always listed.
      // `managed=true` widens it to every internally managed role in one page
      // (PRD 10 "List/get managed users").
      role: filter.managed
        ? { in: [...MANAGED_STAFF_ROLES] }
        : (filter.role ?? StaffRole.OFFICER),
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(filter.region ? { region: filter.region } : {}),
      ...(filter.search
        ? {
            OR: [
              {
                name: { contains: filter.search, mode: 'insensitive' as const },
              },
              {
                email: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                phone: {
                  contains: filter.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    // Sorting by the derived open-ticket count needs every matching officer
    // in hand, not just the page — so it is computed and sorted in memory.
    if (filter.sortBy === 'supportTickets') {
      const rows = await this.prisma.staff.findMany({
        where,
        select: this.officerListSelect,
        orderBy: { name: 'asc' },
      });
      const tickets = await this.openTicketsByOfficer(rows.map((r) => r.id));
      const withCounts = rows.map((r) => this.withTicketCount(r, tickets));
      withCounts.sort(
        compareBy(
          (o) => o._count.supportTickets,
          sortDirection(filter.sortOrder),
        ),
      );
      return paginateInMemory(withCounts, pagination);
    }

    const page = await paginate(
      () => this.prisma.staff.count({ where }),
      (skip, take) =>
        this.prisma.staff.findMany({
          where,
          select: this.officerListSelect,
          orderBy: this.officerOrderBy(filter.sortBy, filter.sortOrder),
          skip,
          take,
        }),
      pagination,
    );

    const tickets = await this.openTicketsByOfficer(page.data.map((o) => o.id));
    return {
      data: page.data.map((o) => this.withTicketCount(o, tickets)),
      meta: page.meta,
    };
  }

  /** Folds the derived open-ticket count into the row's existing `_count`. */
  private withTicketCount<
    T extends { id: string; _count: { customers: number } },
  >(officer: T, tickets: Map<string, number>) {
    return {
      ...officer,
      _count: {
        ...officer._count,
        supportTickets: tickets.get(officer.id) ?? 0,
      },
    };
  }

  /**
   * B-4.1 — officer profile plus the portfolio the Regional Portal renders
   * beside it.
   *
   * `chatThreads` counts the customers this officer has an actual
   * conversation with — one thread per customer, matching how the chat audit
   * groups them.
   */
  async getOfficerDetail(
    officerId: string,
    viewer: { role: string; region?: Region | null } = { role: 'ADMIN' },
  ) {
    const officer = await this.prisma.staff.findUnique({
      where: { id: officerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        region: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        // PRD 12 — who provisioned / retired / restored this account.
        createdBy: { select: { id: true, name: true, email: true } },
        deactivatedAt: true,
        deactivatedBy: { select: { id: true, name: true, email: true } },
        reactivatedAt: true,
        reactivatedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!officer) throw new NotFoundException('Officer not found');

    // The Regional Portal may read officers in its own region only — and only
    // the operational roles it works with. A REGIONAL_ADMIN has no
    // user-management privileges, so administrative accounts (and its own
    // peers) are not theirs to inspect, even one that happens to share a
    // region or carry none at all.
    if (viewer.role === 'REGIONAL_ADMIN') {
      const readable: string[] = [StaffRole.OFFICER, StaffRole.LOADING_OFFICER];
      if (
        !readable.includes(officer.role) ||
        officer.region !== (viewer.region ?? null)
      ) {
        throw new ForbiddenException(
          'You do not have permission to perform this action.',
        );
      }
    }

    const customers = await this.prisma.customer.findMany({
      where: { assignedOfficerId: officerId },
      select: { id: true, name: true, erpId: true, region: true },
      orderBy: { name: 'asc' },
    });
    const customerIds = customers.map((c) => c.id);

    const [openTickets, threads] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { customerId: { in: customerIds }, status: 'OPEN' },
      }),
      this.prisma.message.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
      }),
    ]);

    return {
      ...officer,
      // True when this service owns the account's lifecycle, so the FE knows
      // whether to render the deactivate / reactivate controls at all.
      isManaged: isManagedStaffRole(officer.role),
      _count: {
        customers: customers.length,
        supportTickets: openTickets,
        chatThreads: threads.length,
      },
      customers,
      // Retained so the existing admin officer-detail screen keeps working.
      distributors: customers.length,
      openTickets,
    };
  }

  /**
   * Provision one internally managed staff account (ADMIN, REGIONAL_ADMIN,
   * OFFICER, LOADING_OFFICER). The service database is the source of truth
   * for these accounts — the ERP neither creates nor updates them.
   *
   * `actor` is the authenticated ADMIN, taken from the JWT by the controller.
   * A role in the request body is validated against the managed set; the
   * caller's own role is never read from the body (CC-01).
   */
  async createOfficer(dto: CreateOfficerDto, actor: AdminActor) {
    // Defence in depth: the DTO already restricts `role` to the creatable
    // set, but the service must not depend on a pipe having run.
    const role = normalizeManagedRole(dto.role ?? StaffRole.OFFICER);
    if (!role) {
      throw new BadRequestException({
        message: `role must be one of: ${CREATABLE_STAFF_ROLE_VALUES.join(', ')}`,
        code: 'ROLE_NOT_SUPPORTED',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const name = dto.name?.trim();
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone?.trim();
    if (!name || !email || !phone || !dto.password) {
      throw new BadRequestException(
        'name, email, phone and password are all required.',
      );
    }

    // ADMIN is organisation-wide; every other managed role is region-scoped
    // and half the portal filters on it, so it cannot be left null.
    if (role === StaffRole.ADMIN && dto.region) {
      throw new BadRequestException({
        message:
          'An ADMIN is organisation-wide and cannot be scoped to a region.',
        code: 'REGION_NOT_ALLOWED',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
    if (requiresRegion(role) && !dto.region) {
      throw new BadRequestException({
        message: `region is required for ${role}.`,
        code: 'REGION_REQUIRED',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }
    const region = role === StaffRole.ADMIN ? null : (dto.region ?? null);

    await this.assertStaffIdentityFree(email, phone);

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const officer = await this.prisma.staff
      .create({
        data: {
          role,
          name,
          email,
          phone,
          region,
          password: hashedPassword,
          // PRD 12 audit — which ADMIN provisioned this account.
          createdById: actor.id,
        },
        select: this.createdOfficerSelect,
      })
      .catch((e: unknown) => {
        // The uniqueness check above is advisory: two admins can submit the
        // same email at once. The constraint is the real gate, so translate
        // its failure into the same message rather than a 500.
        throw this.translateStaffUniqueViolation(e);
      });

    // PRD F18 AC4 / US-15.3 — email the new user their login credentials.
    // Provider impls already wrap their own sends in try/catch, but we
    // double-wrap here as a defensive net: account creation must succeed even
    // if email is misconfigured. The response reports whether delivery
    // actually happened rather than claiming success unconditionally.
    let emailSent = true;
    try {
      await this.email.send({
        to: email,
        subject: 'Welcome to the Viju Portal',
        body: [
          `Hello ${name},`,
          '',
          `An account has been created for you on the Viju Portal as ${MANAGED_ROLE_LABELS[role]}.`,
          '',
          `Email:    ${email}`,
          `Region:   ${region ?? '—'}`,
          `Password: ${dto.password}`,
          '',
          'Please log in and change your password as soon as possible.',
          '',
          'Viju Team',
        ].join('\n'),
      });
    } catch (e) {
      emailSent = false;
      this.logger.error(
        `Welcome email failed for ${email} — ${(e as Error).message}. ` +
          'The account was still created successfully.',
      );
    }

    return { ...officer, emailSent };
  }

  /**
   * Refuses a duplicate before the insert so the admin gets a field-specific
   * message. `email` and `phone` are both unique on Staff; email is compared
   * case-insensitively because that is how it is stored and matched at login.
   */
  private async assertStaffIdentityFree(email: string, phone: string) {
    const clash = await this.prisma.staff.findFirst({
      where: {
        OR: [{ email: { equals: email, mode: 'insensitive' } }, { phone }],
      },
      select: { email: true, phone: true },
    });
    if (!clash) return;

    const emailTaken = clash.email.toLowerCase() === email;
    throw new BadRequestException({
      // Wording preserved from before this route grew roles — the web portal
      // renders `message` verbatim.
      message: emailTaken
        ? 'Email already in use'
        : 'Phone number already in use',
      code: emailTaken ? 'EMAIL_IN_USE' : 'PHONE_IN_USE',
      field: emailTaken ? 'email' : 'phone',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }

  /** Maps a Staff P2002 onto the same 400 the pre-flight check produces. */
  private translateStaffUniqueViolation(e: unknown): unknown {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return e;
    }
    const target: unknown = e.meta?.target;
    const fields = Array.isArray(target)
      ? target.filter((t): t is string => typeof t === 'string')
      : typeof target === 'string'
        ? [target]
        : [];
    const emailTaken = fields.some((f) => f.includes('email'));
    return new BadRequestException({
      message: emailTaken
        ? 'Email already in use'
        : 'Phone number already in use',
      code: emailTaken ? 'EMAIL_IN_USE' : 'PHONE_IN_USE',
      field: emailTaken ? 'email' : 'phone',
      statusCode: HttpStatus.BAD_REQUEST,
    });
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
    const customer = await this.prisma.customer.create({
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

    // Same rule ERP-sourced customers get: a customer created without an
    // officer is parked on the default one straight away, rather than sitting
    // invisible in every portal until the next reconcile tick. An admin
    // reassignment later overrides it permanently.
    const assignedOfficerId = await this.defaultOfficer.assignIfUnassigned(
      customer.id,
    );

    return { ...customer, assignedOfficerId };
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

  /**
   * Move every customer currently assigned to one officer over to another in
   * a single call — the prerequisite for deactivating an officer who still has
   * distributors. Target must be an active officer in the same region.
   */
  async reassignAllCustomers(officerId: string, newOfficerId: string) {
    if (officerId === newOfficerId) {
      throw new BadRequestException(
        'Source and target officer must be different.',
      );
    }
    const source = await this.prisma.staff.findUnique({
      where: { id: officerId },
    });
    if (!source) throw new NotFoundException('Officer not found');

    const target = await this.prisma.staff.findFirst({
      where: {
        id: newOfficerId,
        role: 'OFFICER',
        isActive: true,
        ...(source.region ? { region: source.region } : {}),
      },
    });
    if (!target) {
      throw new BadRequestException(
        'Target officer must be active and in the same region.',
      );
    }

    // US-13.5: move BOTH sides of the assignment — the primary pointer on
    // Customer and the CustomerOfficer join rows — so chat threads, tickets
    // and notifications all follow the customer to the new officer and stop
    // reaching the old one.
    const moving = await this.prisma.customer.findMany({
      where: { assignedOfficerId: officerId },
      select: { id: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.updateMany({
        where: { assignedOfficerId: officerId },
        data: { assignedOfficerId: newOfficerId },
      });
      for (const customer of moving) {
        await this.movePrimaryAssignment(
          tx,
          customer.id,
          officerId,
          newOfficerId,
        );
      }
      return updated;
    });

    // US-13.4 — one summary notification for the bulk route.
    if (result.count > 0) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: newOfficerId,
        title: 'Customers assigned',
        body:
          `${result.count} customer${result.count === 1 ? '' : 's'} ` +
          `${result.count === 1 ? 'has' : 'have'} been assigned to you`,
        type: NotificationTypes.ASSIGNMENT,
        data: {
          fromOfficerId: officerId,
          reassigned: String(result.count),
        },
      });
    }

    return {
      reassigned: result.count,
      fromOfficerId: officerId,
      toOfficerId: newOfficerId,
    };
  }

  /**
   * US-15.4 — deactivate or reactivate an internally managed user.
   *
   * Only ADMIN, REGIONAL_ADMIN, OFFICER and LOADING_OFFICER accounts can be
   * moved here; an ERP-mirrored role is refused so the admin cannot half-retire
   * an account the next ERP login would rewrite.
   *
   * Deactivating an account officer is refused while they still hold
   * customers, and the refusal carries a machine-readable `code` plus the
   * exact count so the FE can tell the admin how many to move first, send
   * them to PATCH /admin/officers/:id/reassign-customers, and retry.
   *
   * The write is a CONDITIONAL update (`where: { isActive: !isActive }`) so
   * two concurrent requests cannot both claim to have changed the row: the
   * loser matches zero rows and reports `changed: false`. Sending a status
   * the user already has is therefore idempotent, not an error.
   *
   * On deactivation every outstanding refresh token is revoked in the same
   * transaction, so a live session dies at its next refresh; JwtStrategy
   * already refuses the still-valid access token on every request (US-15.5).
   *
   * Nothing is deleted — the account's chats and tickets stay readable in the
   * admin audit views. Role, region and permissions are preserved across a
   * deactivate/reactivate cycle.
   */
  async setOfficerActive(
    officerId: string,
    isActive: boolean,
    actor: AdminActor = { id: null },
  ) {
    if (typeof isActive !== 'boolean') {
      throw new BadRequestException('isActive must be a boolean.');
    }
    if (!officerId?.trim()) {
      throw new NotFoundException('Officer not found');
    }

    const officer = await this.prisma.staff.findUnique({
      where: { id: officerId },
      select: { id: true, isActive: true, role: true },
    });
    if (!officer) throw new NotFoundException('Officer not found');

    // Guard against retiring an account whose lifecycle this service does not
    // own (today: WAREHOUSE_OFFICER, still mirrored from the ERP).
    if (!isManagedStaffRole(officer.role)) {
      throw new BadRequestException({
        message:
          `A ${officer.role} account is not managed by this service and its ` +
          'status cannot be changed here.',
        code: 'ROLE_NOT_MANAGED',
        role: officer.role,
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    if (!isActive) {
      // An admin locking themselves out is always a mistake.
      if (actor.id && actor.id === officer.id) {
        throw new BadRequestException({
          message: 'You cannot deactivate your own account.',
          code: 'SELF_DEACTIVATION',
          statusCode: HttpStatus.BAD_REQUEST,
        });
      }

      // ...and so is retiring the last admin, which would leave nobody able
      // to reactivate anyone.
      if (officer.role === StaffRole.ADMIN && officer.isActive) {
        const activeAdmins = await this.prisma.staff.count({
          where: { role: StaffRole.ADMIN, isActive: true },
        });
        if (activeAdmins <= 1) {
          throw new ConflictException({
            message:
              'This is the last active administrator. Create another admin ' +
              'before deactivating this one.',
            code: 'LAST_ACTIVE_ADMIN',
            statusCode: HttpStatus.CONFLICT,
          });
        }
      }

      // An account officer's portfolio has to move first, or their customers
      // lose their chat thread and ticket route.
      if (officer.role === StaffRole.OFFICER) {
        const assignedCustomers = await this.prisma.customer.count({
          where: { assignedOfficerId: officerId },
        });
        if (assignedCustomers > 0) {
          throw new ConflictException({
            message:
              `Reassign this officer's ${assignedCustomers} ` +
              `customer${assignedCustomers === 1 ? '' : 's'} before deactivating.`,
            code: 'OFFICER_HAS_CUSTOMERS',
            assignedCustomers,
            statusCode: HttpStatus.CONFLICT,
          });
        }
      }
    }

    const now = new Date();
    const { changed, row } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.staff.updateMany({
        // The status guard is IN the where clause, so concurrent requests
        // serialise on the row instead of both writing an audit stamp.
        where: { id: officerId, isActive: !isActive },
        data: isActive
          ? {
              isActive: true,
              reactivatedAt: now,
              reactivatedById: actor.id ?? null,
            }
          : {
              isActive: false,
              deactivatedAt: now,
              deactivatedById: actor.id ?? null,
            },
      });

      if (count > 0 && !isActive) {
        // US-15.5 — kill every live session in the same transaction, so the
        // deactivation and the revocation cannot come apart.
        await tx.refreshToken.updateMany({
          where: { staffId: officerId, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      const updated = await tx.staff.findUnique({
        where: { id: officerId },
        select: this.officerStatusSelect,
      });
      return { changed: count > 0, row: updated };
    });

    if (!row) throw new NotFoundException('Officer not found');
    return { ...row, changed };
  }

  /**
   * Repoints a single customer at a new officer, keeping the CustomerOfficer
   * join in step with Customer.assignedOfficerId (US-13.5). Nothing is copied
   * and nothing is orphaned: the thread and tickets are read through the
   * current assignment, so they move with it.
   */
  private async repointAssignment(
    customerId: string,
    previousOfficerId: string | null,
    newOfficerId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: { assignedOfficerId: newOfficerId },
      });
      await this.movePrimaryAssignment(
        tx,
        customerId,
        previousOfficerId,
        newOfficerId,
      );
      return updated;
    });
  }

  /**
   * Drops the outgoing officer's primary CustomerOfficer row and makes sure
   * the incoming officer has one. Secondary assignments are left alone.
   */
  private async movePrimaryAssignment(
    tx: Prisma.TransactionClient,
    customerId: string,
    previousOfficerId: string | null,
    newOfficerId: string,
  ) {
    if (previousOfficerId && previousOfficerId !== newOfficerId) {
      await tx.customerOfficer.deleteMany({
        where: { customerId, staffId: previousOfficerId, isPrimary: true },
      });
    }
    await tx.customerOfficer.upsert({
      where: { customerId_staffId: { customerId, staffId: newOfficerId } },
      update: { isPrimary: true },
      create: { customerId, staffId: newOfficerId, isPrimary: true },
    });
  }
}
