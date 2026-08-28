import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoadingRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { paginate } from '../../common/pagination/paginate';
import {
  LoadingQueueQueryDto,
  RecordWaybillDto,
  UpdateLoadingDescriptionDto,
  UpdateQueueStatusDto,
} from './dto/loading.dto';
import {
  assertLoadingTransition,
  toApiStatus,
  toStatusLabel,
  toDbStatus,
} from './loading-status';

/** The relations every queue row needs to render. */
const QUEUE_INCLUDE = {
  customer: { select: { id: true, name: true } },
  linkedPurchase: { select: { erpId: true } },
} satisfies Prisma.LoadingRequestInclude;

type QueueRow = Prisma.LoadingRequestGetPayload<{
  include: typeof QUEUE_INCLUDE;
}>;

/**
 * The loading officer's own work (PRD F13, LO-02 → LO-05).
 *
 * Every read and every write is scoped to the officer on the token. There is
 * no officerId parameter anywhere in this service by design — one loading
 * officer must not be able to see or touch another's assignments.
 */
@Injectable()
export class LoadingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** LO-02 — the signed-in officer's queue. */
  async getMyQueue(officerId: string, query: LoadingQueueQueryDto) {
    const status = query.status ? toDbStatus(query.status) : null;
    const where: Prisma.LoadingRequestWhereInput = {
      assignedOfficerId: officerId,
      status: status
        ? status
        : {
            in: [
              LoadingRequestStatus.ASSIGNED,
              LoadingRequestStatus.LOADING_IN_PROGRESS,
              LoadingRequestStatus.COMPLETED,
            ],
          },
    };

    const page = await paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: { requestedLoadingDate: 'asc' },
          include: QUEUE_INCLUDE,
          skip,
          take,
        }),
      query,
    );

    return { data: page.data.map((r) => this.toQueueItem(r)), meta: page.meta };
  }

  /** LO-03 — detail panel for one assignment the caller owns. */
  async getQueueItem(officerId: string, requestId: string) {
    const request = await this.ensureOwnAssignment(officerId, requestId);
    return {
      ...this.toQueueItem(request),
      truckPlateNumber: request.truckPlateNumber,
      driverName: request.driverName,
      driverPhone: request.driverPhone,
      loadingDate: request.requestedLoadingDate,
      quantityCartons: request.quantityCartons,
      destination: request.destination,
      reference: request.reference,
      attachmentUrl: request.waybillDocumentUrl,
    };
  }

  /**
   * L-2 — set or clear the loading officer's note on a load.
   *
   * Deliberately its own route rather than a field on the status route: the
   * note is written and corrected independently of the status, so saving one
   * must never move the other.
   *
   * Writable by the ASSIGNED loading officer only — `ensureOwnAssignment`
   * answers 403 for anyone else, the same gate the status and waybill routes
   * use.
   *
   * An empty string clears the note back to null. That is a valid save: an
   * officer who mistyped a note needs a way to remove it, and leaving a wrong
   * note in place is worse than leaving none.
   */
  async updateDescription(
    officerId: string,
    requestId: string,
    dto: UpdateLoadingDescriptionDto,
  ) {
    await this.ensureOwnAssignment(officerId, requestId);

    const trimmed = dto.description.trim();
    const cleared = trimmed === '';
    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
      data: {
        description: cleared ? null : trimmed,
        // TS-1 — stamped with the note, and cleared alongside it. Never
        // touched by a status change, which is the whole reason `updatedAt`
        // cannot stand in for it.
        descriptionUpdatedAt: cleared ? null : new Date(),
      },
      include: QUEUE_INCLUDE,
    });

    // The full detail body, so the screen re-renders from this one response
    // rather than refetching.
    return {
      ...this.toQueueItem(updated),
      waybill: updated.reference,
      truckPlateNumber: updated.truckPlateNumber,
      driverName: updated.driverName,
      driverPhone: updated.driverPhone,
      loadingDate: updated.requestedLoadingDate,
      quantityCartons: updated.quantityCartons,
      destination: updated.destination,
      reference: updated.reference,
      attachmentUrl: updated.waybillDocumentUrl,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * LO-04 — advance a load. Illegal transitions are refused with 409 rather
   * than silently accepted, and the distributor is notified on every change,
   * which is the same feed the regional dashboard's pending queue reads.
   */
  async updateStatus(
    officerId: string,
    requestId: string,
    dto: UpdateQueueStatusDto,
  ) {
    const request = await this.ensureOwnAssignment(officerId, requestId);
    const target = toDbStatus(dto.status) as LoadingRequestStatus;
    assertLoadingTransition(request.status, target);

    const cancelling = target === LoadingRequestStatus.CANCELLED;
    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
      data: {
        status: target,
        loadingStartedAt:
          target === LoadingRequestStatus.LOADING_IN_PROGRESS
            ? (request.loadingStartedAt ?? new Date())
            : request.loadingStartedAt,
        completedAt:
          target === LoadingRequestStatus.COMPLETED
            ? new Date()
            : request.completedAt,
        // L-1 — the loading officer cancels their own load through this
        // route. The reason is stored only when one was given: a blank string
        // would read back as "a reason was recorded and it was empty".
        ...(cancelling
          ? {
              cancelledAt: new Date(),
              cancelledById: officerId,
              ...(dto.reason?.trim()
                ? { cancelReason: dto.reason.trim() }
                : {}),
            }
          : {}),
      },
    });

    // P-2 — a status move straight to COMPLETED is a completion too, so it
    // carries the same reference + document link as recordWaybill below.
    await this.notifyCustomer(request.customer.id, target, requestId, {
      reference: updated.reference,
      attachmentUrl: updated.waybillDocumentUrl,
    });
    return {
      id: updated.id,
      status: toApiStatus(updated.status),
      updatedAt: updated.updatedAt,
      cancelledAt: updated.cancelledAt,
      cancelReason: updated.cancelReason,
    };
  }

  /**
   * LO-05 — record the completed load: truck, driver, quantity and an
   * optional proof-of-loading image.
   *
   * The record written here is the same row GET
   * /officers/customers/{id}/waybills reads back, so the officer portal shows
   * the captured values without any further sync.
   */
  async recordWaybill(
    officerId: string,
    requestId: string,
    dto: RecordWaybillDto,
  ) {
    const request = await this.ensureOwnAssignment(officerId, requestId);
    assertLoadingTransition(request.status, LoadingRequestStatus.COMPLETED);

    const updated = await this.prisma.loadingRequest.update({
      where: { id: requestId },
      data: {
        truckPlateNumber: dto.truckPlateNumber,
        driverName: dto.driverName,
        quantityCartons: dto.quantityCartons,
        ...(dto.attachmentUrl ? { waybillDocumentUrl: dto.attachmentUrl } : {}),
        status: LoadingRequestStatus.COMPLETED,
        completedAt: new Date(),
        loadingStartedAt: request.loadingStartedAt ?? new Date(),
      },
    });

    await this.notifyCustomer(
      request.customer.id,
      LoadingRequestStatus.COMPLETED,
      requestId,
      {
        reference: updated.reference,
        attachmentUrl: updated.waybillDocumentUrl,
      },
    );

    return {
      id: updated.id,
      waybillNumber: updated.reference,
      loadingRequestId: updated.id,
      truckPlateNumber: updated.truckPlateNumber,
      driverName: updated.driverName,
      quantityCartons: updated.quantityCartons,
      attachmentUrl: updated.waybillDocumentUrl,
      status: toApiStatus(updated.status),
      createdAt: updated.updatedAt,
    };
  }

  /**
   * Loads an assignment and proves the caller owns it. A request belonging to
   * another officer is a 403, not a 404 filter — the caller asked for a real
   * record they are simply not allowed to see (LO-03).
   */
  private async ensureOwnAssignment(
    officerId: string,
    requestId: string,
  ): Promise<QueueRow> {
    const request = await this.prisma.loadingRequest.findUnique({
      where: { id: requestId },
      include: QUEUE_INCLUDE,
    });
    if (!request) throw new NotFoundException('Loading request not found.');
    if (request.assignedOfficerId !== officerId) {
      throw new ForbiddenException(
        'This loading request is not assigned to you.',
      );
    }
    return request;
  }

  private toQueueItem(request: QueueRow) {
    return {
      id: request.id,
      orderId: request.linkedPurchase?.erpId ?? null,
      distributorName: request.customer.name,
      region: request.region,
      submittedAt: request.createdAt,
      status: toApiStatus(request.status),
      // L-2 / L-1 — on every row, so the DESCRIPTION column and the cancelled
      // state render from the list without a second call per row.
      description: request.description,
      descriptionUpdatedAt: request.descriptionUpdatedAt,
      cancelledAt: request.cancelledAt,
      cancelReason: request.cancelReason,
    };
  }

  /**
   * PRD §6 — the distributor is told whenever their load moves.
   *
   * P-1: a non-terminal move reads "Loading update: Your loading status is
   * now: <label>". The label is derived from the status that was actually
   * reached rather than hard-coded, so a move to ASSIGNED or CANCELLED no
   * longer tells the distributor their load is "Loading in Progress".
   *
   * P-2: completion reads "Loading complete: Your loading is complete. View
   * your waybill in the app." and carries the waybill reference and document
   * URL on the push `data`, so the app can deep-link straight to the document
   * instead of making the distributor hunt for it.
   */
  private notifyCustomer(
    customerId: string,
    status: LoadingRequestStatus,
    requestId: string,
    waybill?: { reference: string; attachmentUrl: string | null },
  ) {
    const completed = status === LoadingRequestStatus.COMPLETED;
    return this.notifications.notify({
      recipientType: 'CUSTOMER',
      recipientId: customerId,
      title: completed ? 'Loading complete' : 'Loading update',
      body: completed
        ? 'Your loading is complete. View your waybill in the app.'
        : `Your loading status is now: ${toStatusLabel(status)}`,
      type: completed
        ? NotificationTypes.WAYBILL_COMPLETED
        : NotificationTypes.WAYBILL_STATUS_CHANGED,
      data: {
        waybillId: requestId,
        // `data` is a string map (FCM carries strings only), and a key is
        // omitted rather than sent as "null" when there is nothing to link to.
        ...(waybill?.reference ? { reference: waybill.reference } : {}),
        ...(waybill?.attachmentUrl
          ? { attachmentUrl: waybill.attachmentUrl }
          : {}),
      },
    });
  }
}
