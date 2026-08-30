import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import { AcceptTermsDto, SubmitLoadingRequestDto } from './dto/waybill.dto';
import { paginate } from '../../common/pagination/paginate';

const TNC_RECENT_WINDOW_MS = 60 * 60 * 1000; // 1h

@Injectable()
export class WaybillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async listForCustomer(
    customerId: string,
    pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
  ) {
    const where = { customerId };
    const page = await paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            reference: true,
            truckPlateNumber: true,
            driverName: true,
            driverPhone: true,
            requestedLoadingDate: true,
            quantityCartons: true,
            destination: true,
            status: true,
            createdAt: true,
            warehouseName: true,
            loadingCapacity: true,
            linkedPurchase: { select: { erpId: true } },
            items: {
              select: {
                id: true,
                productId: true,
                productName: true,
                quantity: true,
                weightPerCarton: true,
              },
            },
          },
          skip,
          take,
        }),
      pagination,
    );
    return {
      ...page,
      data: page.data.map(({ items, ...row }) => ({ ...row, products: items })),
    };
  }

  async getForCustomer(customerId: string, id: string) {
    const wb = await this.prisma.loadingRequest.findFirst({
      where: { id, customerId },
      include: {
        linkedPurchase: { select: { id: true, erpId: true } },
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            weightPerCarton: true,
          },
        },
      },
    });
    if (!wb) throw new NotFoundException('Waybill not found');
    // PRD F6: customers never see an officer's real name — surface a generic
    // label, never the assigned loading officer's identity.
    const { items, ...rest } = wb;
    return {
      ...rest,
      // Named `products` on the wire, matching the submit body; `items` is
      // only the Prisma relation name.
      products: items,
      assignedOfficer: wb.assignedOfficerId
        ? { displayName: 'Viju Loading Officer' }
        : null,
    };
  }

  /**
   * PRD F5 AC4-AC6: Customer accepts T&C, gets the external form URL.
   * Acceptance is recorded so the regional admin has audit trail.
   */
  async acceptTermsAndGetFormUrl(customerId: string, dto: AcceptTermsDto) {
    await this.prisma.termsAcceptance.create({
      data: {
        customerId,
        termsVersion: dto.termsVersion,
      },
    });

    const externalFormUrl =
      process.env.LOADING_FORM_URL ?? 'https://forms.example.com/viju-loading';

    return {
      formUrl: externalFormUrl,
      acceptedAt: new Date(),
      note: 'Open this URL in a browser / in-app web view. Form submission triggers the regional admin assignment flow.',
    };
  }

  /**
   * Direct in-app submission. PRD §7 marks the in-app form as out of
   * scope (external Google Form), but this endpoint stays as the dev
   * surface and as the receiver for the future form webhook so the FE
   * can test the full waybill lifecycle today.
   */
  async submitLoadingRequest(customerId: string, dto: SubmitLoadingRequestDto) {
    const recentTerms = await this.prisma.termsAcceptance.findFirst({
      where: {
        customerId,
        acceptedAt: { gte: new Date(Date.now() - TNC_RECENT_WINDOW_MS) },
      },
      orderBy: { acceptedAt: 'desc' },
    });
    if (!recentTerms) {
      throw new ForbiddenException(
        'You must accept the Viju Terms & Conditions before submitting a loading request.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, region: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const purchase = await this.prisma.purchase.findFirst({
      where: { id: dto.linkedPurchaseId, customerId },
    });
    if (!purchase) {
      throw new BadRequestException(
        'Linked order not found or does not belong to this customer.',
      );
    }

    const products = dto.products ?? [];
    // `loadingCapacity` is the TRUCK's capacity, not the load. The load is the
    // sum of the product lines, and it is mirrored onto `quantityCartons` so
    // every existing stock calculation - which reads that column on COMPLETED
    // requests - keeps working without knowing about product lines.
    const loadedCartons = products.reduce((sum, p) => sum + p.quantity, 0);

    const reference = `WB-${Date.now().toString().slice(-6)}`;
    const request = await this.prisma.loadingRequest.create({
      data: {
        reference,
        customerId,
        region: customer.region,
        linkedPurchaseId: dto.linkedPurchaseId,
        truckPlateNumber: dto.truckPlateNumber,
        driverName: dto.driverName,
        driverPhone: dto.driverPhone,
        requestedLoadingDate: new Date(dto.requestedLoadingDate),
        quantityCartons:
          products.length > 0 ? loadedCartons : dto.quantityCartons,
        destination: dto.destination,
        warehouseName: dto.warehouseName,
        loadingCapacity: dto.loadingCapacity,
        termsAcceptedAt: recentTerms.acceptedAt,
        status: 'PENDING_ASSIGNMENT',
        // Stored as sent, never re-resolved: this records what the distributor
        // declared they were loading, and it must not change under them if the
        // specification sheet is later corrected.
        ...(products.length > 0
          ? {
              items: {
                create: products.map((p) => ({
                  productId: p.productId ?? null,
                  productName: p.productName,
                  quantity: p.quantity,
                  weightPerCarton: p.weightPerCarton ?? null,
                })),
              },
            }
          : {}),
      },
      include: { items: true },
    });
    const { items: createdItems, ...created } = request;

    // PRD F5 AC7 + §6 / N-2: one row per REGIONAL_ADMIN OF THIS REGION, and
    // nobody else. A loading request is raised against one region and only
    // that region's admin acts on it, so an ADMIN or an OFFICER receiving it
    // would be reading someone else's queue. `isActive` is checked so a
    // retired account stops accruing a queue it will never work.
    const regionalAdmins = await this.prisma.staff.findMany({
      where: {
        role: 'REGIONAL_ADMIN',
        region: customer.region,
        isActive: true,
      },
      select: { id: true },
    });
    for (const admin of regionalAdmins) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: admin.id,
        subjectCustomerId: customer.id,
        title: 'New loading request',
        body: `${customer.name} raised a loading request in ${customer.region}`,
        type: NotificationTypes.WAYBILL_SUBMITTED,
        data: {
          waybillId: request.id,
          reference: request.reference,
          region: customer.region,
        },
      });
    }

    return { ...created, products: createdItems };
  }
}
