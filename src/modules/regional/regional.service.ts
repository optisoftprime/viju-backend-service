import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import {
  AssignLoadingOfficerDto,
  UpdateLoadingStatusDto,
} from './dto/regional.dto';
import { Region, LoadingRequestStatus } from '@prisma/client';

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
        include: {
          customer: { select: { name: true } },
          linkedPurchase: { select: { erpId: true } },
        },
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
      pendingLoadingRequests: pendingRequests.map((r) => ({
        id: r.id,
        reference: r.reference,
        distributorName: r.customer.name,
        orderId: r.linkedPurchase?.erpId,
        loadingDate: r.requestedLoadingDate,
        truckPlateNumber: r.truckPlateNumber,
        driverName: r.driverName,
        quantityCartons: r.quantityCartons,
        status: r.status,
        submittedAt: r.createdAt,
      })),
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
    });

    // PRD §6 — notify the assigned officer
    await this.notifications.notify({
      recipientType: 'STAFF',
      recipientId: officer.id,
      title: 'Loading request assigned',
      body: `Assigned to you — ${request.customer.name}`,
      type: 'WAYBILL_ASSIGNED',
      data: { waybillId: requestId },
    });
    // PRD §6 — notify the distributor
    await this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: request.customer.id,
      title: 'Your loading request has been assigned',
      body: `Estimated date: ${request.requestedLoadingDate.toISOString().slice(0, 10)}`,
      type: 'WAYBILL_ASSIGNED',
      data: { waybillId: requestId },
    });

    return updated;
  }

  async listRequestsByStatus(
    region: Region,
    status: LoadingRequestStatus | 'ALL',
  ) {
    return this.prisma.loadingRequest.findMany({
      where: {
        region,
        ...(status !== 'ALL' ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true } },
        assignedOfficer: { select: { name: true } },
        linkedPurchase: { select: { erpId: true } },
      },
    });
  }

  // ─── Loading / Warehouse Officer queue (PRD F13) ────────
  async getMyLoadingQueue(officerId: string) {
    return this.prisma.loadingRequest.findMany({
      where: {
        assignedOfficerId: officerId,
        status: { in: ['ASSIGNED', 'LOADING_IN_PROGRESS'] },
      },
      orderBy: { requestedLoadingDate: 'asc' },
      include: {
        customer: { select: { name: true } },
        linkedPurchase: { select: { erpId: true } },
      },
    });
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

    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
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
          ? 'WAYBILL_COMPLETED'
          : 'WAYBILL_STATUS_CHANGED',
      data: { waybillId: requestId },
    });

    return updated;
  }
}
