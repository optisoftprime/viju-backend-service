import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import {
  AssignLoadingOfficerDto,
  UpdateLoadingStatusDto,
} from './dto/regional.dto';
import { LoadingRequestStatus, Prisma } from '@prisma/client';
import { Region } from '../../common/region/region.constants';
import { paginate } from '../../common/pagination/paginate';
import {
  assertLoadingTransition,
  toApiStatus,
  toDbStatus,
} from '../loading/loading-status';

/** Relations every loading-request row needs to render. */
const LOADING_REQUEST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  assignedOfficer: { select: { id: true, name: true } },
  linkedPurchase: { select: { id: true, erpId: true } },
} satisfies Prisma.LoadingRequestInclude;

type LoadingRequestRow = Prisma.LoadingRequestGetPayload<{
  include: typeof LOADING_REQUEST_INCLUDE;
}>;

@Injectable()
export class RegionalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ─── Regional Admin Dashboard (PRD F12) ─────────────────
  async getRegionalDashboard(region: Region) {
    const [
      totalDistributors,
      openTickets,
      pendingWaybills,
      activeOfficers,
      pendingRequests,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { region } }),
      this.prisma.supportTicket.count({
        where: { customer: { region }, status: 'OPEN' },
      }),
      this.prisma.loadingRequest.count({
        where: { region, status: 'PENDING_ASSIGNMENT' },
      }),
      this.prisma.staff.count({
        where: { region, role: 'OFFICER', isActive: true },
      }),
      this.prisma.loadingRequest.findMany({
        where: { region, status: 'PENDING_ASSIGNMENT' },
        orderBy: { createdAt: 'asc' },
        include: LOADING_REQUEST_INCLUDE,
        take: 50,
      }),
    ]);

    return {
      summary: {
        totalDistributors,
        openTickets,
        pendingWaybills,
        activeOfficers,
      },
      pendingLoadingRequests: pendingRequests.map((r) => this.toRow(r)),
    };
  }

  /**
   * One loading request, in the shape the regional screens render.
   *
   * `waybill` is the WB reference this platform assigns; `reference` /
   * `orderId` identify the ERP order it was raised against. `status` is
   * translated to the portal vocabulary (PENDING / IN_PROGRESS) — see
   * modules/loading/loading-status.ts.
   */
  private toRow(request: LoadingRequestRow) {
    return {
      id: request.id,
      waybill: request.reference,
      reference: request.linkedPurchase?.erpId ?? request.reference,
      distributorName: request.customer.name,
      orderId: request.linkedPurchaseId,
      truckPlateNumber: request.truckPlateNumber,
      driverName: request.driverName,
      driverPhone: request.driverPhone,
      quantityCartons: request.quantityCartons,
      loadingDate: request.requestedLoadingDate,
      submittedAt: request.createdAt,
      status: toApiStatus(request.status),
      assignedOfficer: request.assignedOfficer
        ? { id: request.assignedOfficer.id, name: request.assignedOfficer.name }
        : null,
    };
  }

  /**
   * PRD F12 AC5-AC7: Regional admin assigns request to a loading / warehouse
   * officer in the same region. Notifies both the officer and the distributor.
   */
  async assignLoadingRequest(
    region: Region,
    requesterId: string,
    requestId: string,
    dto: AssignLoadingOfficerDto,
  ) {
    const request = await this.prisma.loadingRequest.findFirst({
      where: { id: requestId, region },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!request)
      throw new NotFoundException('Loading request not found in your region.');
    if (request.status !== 'PENDING_ASSIGNMENT')
      throw new BadRequestException('This request has already been assigned.');

    const officer = await this.prisma.staff.findFirst({
      where: {
        id: dto.loadingOfficerId,
        region,
        role: { in: ['LOADING_OFFICER', 'WAREHOUSE_OFFICER'] },
        isActive: true,
      },
    });
    if (!officer)
      throw new BadRequestException(
        'Loading officer not found or not in this region.',
      );

    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
      data: {
        status: 'ASSIGNED',
        assignedOfficerId: officer.id,
        assignedAt: new Date(),
        assignedById: requesterId,
      },
      include: LOADING_REQUEST_INCLUDE,
    });

    // PRD §6 — notify the assigned officer
    await this.notifications.notify({
      recipientType: 'STAFF',
      recipientId: officer.id,
      title: 'Loading request assigned',
      body: `Assigned to you — ${request.customer.name}`,
      type: NotificationTypes.WAYBILL_ASSIGNED,
      data: { waybillId: requestId },
    });
    // PRD §6 — notify the distributor
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: request.customer.id,
      title: 'Your loading request has been assigned',
      body: `Estimated date: ${request.requestedLoadingDate.toISOString().slice(0, 10)}`,
      type: NotificationTypes.WAYBILL_ASSIGNED,
      data: { waybillId: requestId },
    });

    return this.toRow(updated);
  }

  /**
   * RA-06 — the regional admin's loading-request list.
   *
   * `region` is always the caller's own region, resolved from the token by
   * the controller; it is never taken from the query string for a regional
   * admin. `status` accepts the portal vocabulary (PENDING | ASSIGNED |
   * IN_PROGRESS | COMPLETED) as well as the database spelling, matching the
   * FE's filter tabs.
   */
  async listRequestsByStatus(
    region: Region,
    status: string,
    query: { page: number; pageSize: number; search?: string } = {
      page: 1,
      pageSize: 20,
    },
  ) {
    const dbStatus = status === 'ALL' ? null : toDbStatus(status);
    const search = query.search?.trim();
    const where: Prisma.LoadingRequestWhereInput = {
      region,
      ...(dbStatus ? { status: dbStatus } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { truckPlateNumber: { contains: search, mode: 'insensitive' } },
              { driverName: { contains: search, mode: 'insensitive' } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
              {
                linkedPurchase: {
                  erpId: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const page = await paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: LOADING_REQUEST_INCLUDE,
          skip,
          take,
        }),
      query,
    );
    return { data: page.data.map((r) => this.toRow(r)), meta: page.meta };
  }

  // ─── Loading / Warehouse Officer queue (PRD F13) ────────
  async getMyLoadingQueue(
    officerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = {
      assignedOfficerId: officerId,
      status: {
        in: ['ASSIGNED', 'LOADING_IN_PROGRESS'] as LoadingRequestStatus[],
      },
    };
    return paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: { requestedLoadingDate: 'asc' },
          include: {
            customer: { select: { name: true } },
            linkedPurchase: { select: { erpId: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  async updateLoadingStatus(
    officerId: string,
    requestId: string,
    dto: UpdateLoadingStatusDto,
  ) {
    const request = await this.prisma.loadingRequest.findUnique({
      where: { id: requestId },
      include: { customer: { select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Loading request not found.');
    if (request.assignedOfficerId !== officerId)
      throw new ForbiddenException(
        'You are not the assigned officer for this request.',
      );

    if (dto.status === 'COMPLETED' && !dto.waybillDocumentUrl) {
      throw new BadRequestException(
        'waybillDocumentUrl is required when marking a request COMPLETED (PRD F13 AC3).',
      );
    }

    // LO-04 — the same transition rules the /loading queue enforces, so both
    // routes refuse an illegal move (e.g. reopening a completed load) with a
    // 409 instead of one of them silently accepting it.
    assertLoadingTransition(request.status, dto.status);

    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
      include: LOADING_REQUEST_INCLUDE,
      data: {
        status: dto.status,
        notes: dto.notes,
        loadingStartedAt:
          dto.status === 'LOADING_IN_PROGRESS'
            ? (request.loadingStartedAt ?? new Date())
            : request.loadingStartedAt,
        completedAt: dto.status === 'COMPLETED' ? new Date() : null,
        waybillDocumentUrl:
          dto.status === 'COMPLETED'
            ? dto.waybillDocumentUrl
            : request.waybillDocumentUrl,
      },
    });

    // PRD §6 — distributor push notification on status change
    const body =
      dto.status === 'COMPLETED'
        ? 'Your loading is complete. View your waybill in the app.'
        : `Your loading status is now: Loading in Progress`;
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: request.customer.id,
      title: 'Loading status update',
      body,
      type:
        dto.status === 'COMPLETED'
          ? NotificationTypes.WAYBILL_COMPLETED
          : NotificationTypes.WAYBILL_STATUS_CHANGED,
      data: { waybillId: requestId },
    });

    return this.toRow(updated);
  }
}
