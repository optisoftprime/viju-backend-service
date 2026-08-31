import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import {
  AcceptTermsDto,
  LoadingRequestProductDto,
  SubmitLoadingRequestDto,
} from './dto/waybill.dto';
import { paginate } from '../../common/pagination/paginate';

/**
 * How many reference variants to try before giving up.
 *
 * One order is loaded in parts a handful of times at most, so this only ever
 * bites on a genuine collision storm rather than normal partial loading.
 */
const MAX_REFERENCE_ATTEMPTS = 25;

/**
 * Ceiling on product lines across every order on one request. The DTO caps the
 * single-order array; this is the same bound applied to the multi-order map,
 * whose total is only known once the orders are flattened.
 */
const MAX_LOADING_REQUEST_LINES = 200;

const TNC_RECENT_WINDOW_MS = 60 * 60 * 1000; // 1h

/**
 * Every order a request draws on, primary first.
 *
 * The primary lives in the `linkedPurchaseId` column; the rest are only
 * recorded as the orders the product lines came from, so the full set is the
 * union of the two. Deriving it here keeps one answer for the list, the
 * detail and the submit response.
 */
function linkedPurchaseIdsOf(
  linkedPurchaseId: string | null,
  items: { purchaseId: string | null }[],
): string[] {
  const ids = new Set<string>();
  if (linkedPurchaseId) ids.add(linkedPurchaseId);
  for (const item of items) if (item.purchaseId) ids.add(item.purchaseId);
  return [...ids];
}

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
            linkedPurchaseId: true,
            linkedPurchase: { select: { erpId: true } },
            items: {
              select: {
                id: true,
                purchaseId: true,
                orderReference: true,
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
      data: page.data.map(({ items, ...row }) => ({
        ...row,
        linkedPurchaseIds: linkedPurchaseIdsOf(row.linkedPurchaseId, items),
        products: items,
      })),
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
            purchaseId: true,
            orderReference: true,
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
      linkedPurchaseIds: linkedPurchaseIdsOf(wb.linkedPurchaseId, items),
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
   * Resolves `linkedPurchaseId` - one order id or a list of them - to the
   * orders the request is raised against.
   *
   * A truck loads from several sales orders, so the field takes an array. The
   * FIRST entry is the primary: it goes in the `linkedPurchaseId` column and
   * its DOC_NO becomes the request's `reference`. A bare string is still
   * accepted and behaves exactly as it did.
   *
   * Every entry is scoped to the caller, so a distributor cannot file a
   * request against another distributor's order.
   */
  private async resolveLinkedOrders(
    customerId: string,
    linkedPurchaseId: string | string[],
  ): Promise<{ id: string; erpId: string }[]> {
    const isList = Array.isArray(linkedPurchaseId);
    const raw = isList ? linkedPurchaseId : [linkedPurchaseId];
    if (raw.length === 0) {
      throw new BadRequestException(
        'linkedPurchaseId must name at least one order.',
      );
    }
    if (raw.some((id) => typeof id !== 'string' || id.trim() === '')) {
      throw new BadRequestException(
        'linkedPurchaseId must be an order id, or an array of order ids.',
      );
    }
    // The same order twice is a duplicate, not two orders. Order is kept
    // because the first entry decides the reference.
    const ids = [...new Set(raw.map((id) => id.trim()))];

    const orders: { id: string; erpId: string }[] = [];
    for (const id of ids) {
      const order = await this.prisma.purchase.findFirst({
        where: { OR: [{ id }, { erpId: id }], customerId },
        select: { id: true, erpId: true },
      });
      if (!order) {
        // The single-order form keeps its original wording: clients already
        // match on it.
        throw new BadRequestException(
          isList
            ? `Linked order "${id}" was not found or does not belong to this customer.`
            : 'Linked order not found or does not belong to this customer.',
        );
      }
      orders.push(order);
    }
    return orders;
  }

  /**
   * Flattens the submitted product lines, resolving which order each came from.
   *
   * Two shapes are accepted. `orders` keys the lines by order, so one request
   * can draw on several; `products` is the single-order form and is treated as
   * belonging to `linkedPurchaseId`. `orders` wins if both are sent.
   *
   * EVERY order named must belong to the caller. Without that check a
   * distributor could attach another distributor's order by id and have its
   * products recorded against their own load.
   */
  private async resolveOrderLines(
    customerId: string,
    dto: SubmitLoadingRequestDto,
    linked: { id: string; erpId: string }[],
  ): Promise<
    {
      purchaseId: string | null;
      orderReference: string | null;
      productId: string | null;
      productName: string;
      quantity: number;
      weightPerCarton: number | null;
    }[]
  > {
    const toLine = (
      p: LoadingRequestProductDto,
      order: { id: string; erpId: string } | null,
    ) => ({
      purchaseId: order?.id ?? null,
      orderReference: order?.erpId ?? null,
      productId: p.productId ?? null,
      productName: p.productName,
      quantity: p.quantity,
      weightPerCarton: p.weightPerCarton ?? null,
    });

    const primary = linked[0];
    if (!dto.orders) {
      return (dto.products ?? []).map((p) => toLine(p, primary));
    }

    const entries = Object.entries(dto.orders);
    const covered = new Set<string>();
    const lines: ReturnType<typeof toLine>[] = [];
    for (const [key, products] of entries) {
      if (!Array.isArray(products)) {
        throw new BadRequestException(
          `orders["${key}"] must be an array of products.`,
        );
      }
      // The key may be a Purchase.id uuid or the ERP DOC_NO; both identify one
      // order, and the customer scope is what makes it safe.
      const order =
        linked.find((o) => o.id === key || o.erpId === key) ??
        (await this.prisma.purchase.findFirst({
          where: { OR: [{ id: key }, { erpId: key }], customerId },
          select: { id: true, erpId: true },
        }));
      if (!order) {
        throw new BadRequestException(
          `Order "${key}" was not found or does not belong to this customer.`,
        );
      }
      covered.add(order.id);
      for (const product of products) {
        if (!product?.productName || typeof product.quantity !== 'number') {
          throw new BadRequestException(
            `orders["${key}"] contains a line without a productName or quantity.`,
          );
        }
        if (product.quantity < 1) {
          throw new BadRequestException(
            `orders["${key}"] contains a line with a quantity below 1.`,
          );
        }
        lines.push(
          toLine(
            {
              ...product,
              // A number is coerced here too, matching the single-order form.
              productId:
                typeof product.productId === 'number'
                  ? String(product.productId)
                  : product.productId,
            },
            order,
          ),
        );
      }
    }
    if (lines.length > MAX_LOADING_REQUEST_LINES) {
      throw new BadRequestException(
        `A loading request cannot carry more than ${MAX_LOADING_REQUEST_LINES} product lines.`,
      );
    }
    // An order named in the LIST form but absent from `orders` would be
    // dropped: the lines are the only record of which orders a request draws
    // on. Say so rather than lose it. The single-order form is left alone -
    // it never promised the two agreed.
    if (Array.isArray(dto.linkedPurchaseId)) {
      const missing = linked.find((o) => !covered.has(o.id));
      if (missing) {
        throw new BadRequestException(
          `Order "${missing.erpId}" is listed in linkedPurchaseId but has no products in \`orders\`.`,
        );
      }
    }
    return lines;
  }

  /**
   * Creates the request with a reference derived from the ERP document.
   *
   * `reference` used to be `WB-<timestamp>`, which carried no relationship to
   * anything the ERP or the distributor recognises. It is now the DOC_NO of
   * the order being loaded - the same value `linkedPurchase.erpId` carries -
   * so a reference can be matched against the ERP by eye.
   *
   * ONE ORDER CAN HAVE SEVERAL LOADS. A distributor may load an order in
   * parts, and `reference` is @unique, so the bare DOC_NO cannot be used for
   * the second. Later loads take a `-02`, `-03` suffix.
   *
   * The suffix is resolved by RETRYING on the unique violation rather than by
   * counting first: two submissions racing on the same order would otherwise
   * compute the same number and one would fail outright.
   */
  private async createWithOrderReference(
    docNo: string,
    data: Omit<Prisma.LoadingRequestUncheckedCreateInput, 'reference'>,
  ) {
    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      const reference =
        attempt === 1 ? docNo : `${docNo}-${String(attempt).padStart(2, '0')}`;
      try {
        return await this.prisma.loadingRequest.create({
          data: {
            ...data,
            reference,
          },
          include: { items: true },
        });
      } catch (e) {
        // P2002 = unique violation. Any other failure is not ours to retry.
        const isDuplicate =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002';
        if (!isDuplicate || attempt === MAX_REFERENCE_ATTEMPTS) throw e;
      }
    }
    // Unreachable: the loop either returns or throws on its last attempt.
    throw new BadRequestException(
      'Could not allocate a loading reference for this order. Please try again.',
    );
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

    // The first is the PRIMARY order: the request is filed under it and its
    // DOC_NO becomes the reference.
    const linkedOrders = await this.resolveLinkedOrders(
      customerId,
      dto.linkedPurchaseId,
    );
    const purchase = linkedOrders[0];

    const lines = await this.resolveOrderLines(customerId, dto, linkedOrders);
    // `loadingCapacity` is the TRUCK's capacity, not the load. The load is the
    // sum of the product lines ACROSS EVERY ORDER, and it is mirrored onto
    // `quantityCartons` so every existing stock calculation - which reads that
    // column on COMPLETED requests - keeps working without knowing about
    // product lines.
    const loadedCartons = lines.reduce((sum, l) => sum + l.quantity, 0);

    const request = await this.createWithOrderReference(purchase.erpId, {
      customerId,
      region: customer.region,
      linkedPurchaseId: purchase.id,
      truckPlateNumber: dto.truckPlateNumber,
      driverName: dto.driverName,
      driverPhone: dto.driverPhone,
      requestedLoadingDate: new Date(dto.requestedLoadingDate),
      quantityCartons: lines.length > 0 ? loadedCartons : dto.quantityCartons,
      destination: dto.destination,
      warehouseName: dto.warehouseName,
      loadingCapacity: dto.loadingCapacity,
      termsAcceptedAt: recentTerms.acceptedAt,
      status: 'PENDING_ASSIGNMENT',
      // Stored as sent, never re-resolved: this records what the distributor
      // declared they were loading, and it must not change under them if the
      // specification sheet is later corrected.
      ...(lines.length > 0 ? { items: { create: lines } } : {}),
    });
    const { items, ...created } = request;
    const createdItems = items ?? [];

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

    return {
      ...created,
      // Every order this request draws on, primary first - the array the
      // client sent, resolved to uuids.
      linkedPurchaseIds: linkedPurchaseIdsOf(created.linkedPurchaseId, [
        ...linkedOrders.map((o) => ({ purchaseId: o.id })),
        ...createdItems,
      ]),
      products: createdItems,
    };
  }
}
