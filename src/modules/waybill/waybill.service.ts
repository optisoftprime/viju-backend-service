import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
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
    return paginate(
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
            linkedPurchase: { select: { erpId: true } },
          },
          skip,
          take,
        }),
      pagination,
    );
  }

  async getForCustomer(customerId: string, id: string) {
    const wb = await this.prisma.loadingRequest.findFirst({
      where: { id, customerId },
      include: {
        linkedPurchase: { select: { id: true, erpId: true } },
      },
    });
    if (!wb) throw new NotFoundException('Waybill not found');
    // PRD F6: customers never see an officer's real name — surface a generic
    // label, never the assigned loading officer's identity.
    return {
      ...wb,
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
        quantityCartons: dto.quantityCartons,
        destination: dto.destination,
        termsAcceptedAt: recentTerms.acceptedAt,
        status: 'PENDING_ASSIGNMENT',
      },
    });

    // PRD F5 AC7 + §6: notify the regional admin of the new request.
    const regionalAdmins = await this.prisma.staff.findMany({
      where: { role: 'REGIONAL_ADMIN', region: customer.region },
      select: { id: true },
    });
    for (const admin of regionalAdmins) {
      await this.notifications.notify({
        recipientType: 'STAFF',
        recipientId: admin.id,
        title: 'New loading request',
        body: `${customer.name} — ${customer.region}`,
        type: 'WAYBILL_SUBMITTED',
        data: { waybillId: request.id, region: customer.region },
      });
    }

    return request;
  }
}
