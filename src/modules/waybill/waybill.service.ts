import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { NotificationTypes } from '../../common/notifications/notification-types';
import {
  AcceptTermsDto,
  LoadingRequestProductDto,
  SubmitLoadingRequestDto,
  UpdateLoadingRequestDto,
  WaybillListQueryDto,
} from './dto/waybill.dto';
import { paginate } from '../../common/pagination/paginate';

/** The page a list query asks for. */
function pagination(query: { page?: number; pageSize?: number }) {
  return { page: query.page ?? 1, pageSize: query.pageSize ?? 20 };
}
import { resolveProduct } from '../erp/product-specification.resolver';

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
 * The product rows a screen renders: one per PRODUCT, not one per stored line.
 *
 * A request can hold the same product on several lines - taken from two
 * different orders, or entered twice - and a distributor reading their own
 * loading request wants to see "120 cartons of table water", not two rows
 * that they have to add up.
 *
 * Merged on `productId`. A line the ERP gives no code for falls back to its
 * name and spec, so those still merge rather than being scattered.
 *
 * The FIRST line's id is kept: the rows are a view of the lines, and a merged
 * row has no id of its own to offer.
 */
function mergeProductLines(
  lines: {
    id: string;
    productId: string | null;
    productName: string;
    spec: string | null;
    quantity: number;
    weightPerCarton: number | null;
  }[],
) {
  const merged = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    const key = line.productId
      ? `code:${line.productId}`
      : `name:${line.productName}|${line.spec ?? ''}`;
    const seen = merged.get(key);
    if (seen) {
      seen.quantity += line.quantity;
      // The weight is a property of the product, so any line that states one
      // states the same one. Take the first that does.
      seen.weightPerCarton ??= line.weightPerCarton;
      seen.spec ??= line.spec;
      continue;
    }
    merged.set(key, { ...line });
  }
  return [...merged.values()];
}

/** One product line, as it is stored. */
interface LoadingLine {
  purchaseId: string | null;
  orderReference: string | null;
  productId: string | null;
  productName: string;
  spec: string | null;
  quantityLeft: number | null;
  quantity: number;
  weightPerCarton: number | null;
}

/**
 * Cartons to load on one line.
 *
 * `quantityToLoad` is what the form sends. `quantity` was its former name and
 * is still read, so a client written against the old shape keeps working;
 * `quantityToLoad` wins when both are present.
 */
function quantityOf(p: { quantityToLoad?: number; quantity?: number }): number {
  return p.quantityToLoad ?? p.quantity ?? 0;
}

/**
 * The weight of a load, and how much of it could actually be weighed.
 *
 * `unweighed` counts lines carrying no carton weight from any source. They
 * contribute nothing to `totalWeightKg`, so a load that is partly unweighable
 * can only ever be UNDER-estimated - the guard below stays conservative and
 * lets it through rather than rejecting on a figure it cannot stand behind.
 */
interface LoadWeight {
  totalWeightKg: number;
  unweighed: number;
}

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

/** A line as the detail endpoint reads it back. */
type LoadingRequestLine = {
  id: string;
  purchaseId: string | null;
  orderReference: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  weightPerCarton: number | null;
};

/**
 * Cartons and kilograms for a set of lines.
 *
 * `weightIsComplete` is false when ANY line has no carton weight - the
 * specification sheet does not cover every product - so the app can render
 * "1,747 kg +" or a dash instead of presenting a partial sum as the total.
 */
function totalsOf(lines: LoadingRequestLine[]) {
  let cartons = 0;
  let weight = 0;
  let complete = true;
  for (const line of lines) {
    cartons += line.quantity;
    if (line.weightPerCarton === null) complete = false;
    else weight += line.quantity * line.weightPerCarton;
  }
  return {
    productLines: lines.length,
    totalCartons: cartons,
    // Kilograms carry two decimals in the sheet; the sum should not carry
    // floating-point noise past that.
    totalWeightKg: Math.round(weight * 100) / 100,
    weightIsComplete: complete,
  };
}

@Injectable()
export class WaybillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Edits a loading request the distributor has raised but nobody has acted
   * on yet.
   *
   * ONLY WHILE PENDING_ASSIGNMENT. Once a regional admin has assigned it, or
   * an officer has begun loading, people are working to what it says; letting
   * the distributor move the quantities underneath them would put the truck
   * and the paperwork out of step. Those cases answer 409, not 403, because
   * the request is real and the caller owns it - it is the state that refuses.
   *
   * The product lines are REPLACED wholesale when `products` or `orders` is
   * sent, and left alone when neither is. A partial line list has no sensible
   * meaning.
   *
   * The capacity rule is re-checked against the MERGED result, so editing the
   * quantities and leaving the old `loadingCapacity` behind is caught - which
   * is exactly the mistake the rule exists for.
   *
   * `reference` never changes. It is what the depot and the ERP know the
   * request by, and re-filing it against a different order does not make it a
   * different request.
   */
  async updateLoadingRequest(
    customerId: string,
    id: string,
    dto: UpdateLoadingRequestDto,
  ) {
    const existing = await this.prisma.loadingRequest.findFirst({
      where: { id, customerId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Waybill not found');
    if (existing.status !== 'PENDING_ASSIGNMENT') {
      throw new ConflictException(
        `This loading request is ${existing.status.toLowerCase().replace(/_/g, ' ')} ` +
          'and can no longer be edited. Cancel it and raise a new one.',
      );
    }

    const linkedOrders =
      dto.linkedPurchaseId === undefined
        ? []
        : await this.resolveLinkedOrders(customerId, dto.linkedPurchaseId);

    // Only when the caller sent lines. Otherwise the stored ones stand, and
    // they are what the capacity is checked against.
    const replacingLines =
      dto.products !== undefined || dto.orders !== undefined;
    const lines = replacingLines
      ? await this.resolveOrderLines(
          customerId,
          dto as unknown as SubmitLoadingRequestDto,
          linkedOrders.length > 0
            ? linkedOrders
            : existing.linkedPurchaseId
              ? [
                  {
                    id: existing.linkedPurchaseId,
                    erpId: existing.reference,
                  },
                ]
              : [],
        )
      : existing.items.map((i) => ({
          purchaseId: i.purchaseId,
          orderReference: i.orderReference,
          productId: i.productId,
          productName: i.productName,
          spec: i.spec,
          quantityLeft: i.quantityLeft,
          quantity: i.quantity,
          weightPerCarton: i.weightPerCarton,
        }));

    // Checked against the merged result: a capacity the caller did not resend
    // still has to match the lines they did.
    const capacity =
      dto.loadingCapacity ?? existing.loadingCapacity ?? undefined;
    this.assertCapacityMatchesLoad(capacity, lines);

    const loadedCartons = lines.reduce((sum, l) => sum + l.quantity, 0);
    const updated = await this.prisma.loadingRequest.update({
      where: { id },
      data: {
        truckPlateNumber: dto.truckPlateNumber,
        driverName: dto.driverName,
        driverPhone: dto.driverPhone,
        requestedLoadingDate: dto.requestedLoadingDate
          ? new Date(dto.requestedLoadingDate)
          : undefined,
        destination: dto.destination,
        warehouseName: dto.warehouseName,
        loadingCapacity: dto.loadingCapacity,
        ...(linkedOrders.length > 0
          ? { linkedPurchaseId: linkedOrders[0].id }
          : {}),
        ...(replacingLines
          ? {
              quantityCartons: lines.length > 0 ? loadedCartons : undefined,
              // Replaced wholesale, in one transaction with the update, so a
              // failure cannot leave the request with half its lines.
              items: { deleteMany: {}, create: lines },
            }
          : {}),
      },
      include: { items: true },
    });

    const { items, ...rest } = updated;
    return {
      ...rest,
      linkedPurchaseIds: linkedPurchaseIdsOf(updated.linkedPurchaseId, items),
      products: items,
    };
  }

  async listForCustomer(
    customerId: string,
    query: WaybillListQueryDto = {
      page: 1,
      pageSize: 20,
    },
  ) {
    const where = { customerId };

    // The distributor's account officers, fetched ONCE for the page: every row
    // belongs to the same distributor, so asking per row would be the same
    // answer twenty times over.
    const officers = await this.accountOfficersOf(customerId);

    const page = await paginate(
      () => this.prisma.loadingRequest.count({ where }),
      (skip, take) =>
        this.prisma.loadingRequest.findMany({
          where,
          orderBy: this.listOrderBy(query),
          select: {
            id: true,
            reference: true,
            customerId: true,
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
            // What the LOADING officer wrote about the load.
            description: true,
            // Why a regional admin or account officer cancelled it.
            cancelReason: true,
            // No linkedPurchaseId / linkedPurchase: the request is filed
            // against the ACCOUNT, and the list renders products, not orders.
            // `reference` still carries the ERP document number where one
            // exists, and the detail route still breaks the load down by
            // order.
            items: {
              select: {
                id: true,
                productId: true,
                productName: true,
                spec: true,
                quantity: true,
                weightPerCarton: true,
              },
            },
          },
          skip,
          take,
        }),
      pagination(query),
    );
    return {
      ...page,
      data: page.data.map(({ items, ...row }) => ({
        ...row,
        accountOfficers: officers,
        products: mergeProductLines(items),
      })),
    };
  }

  /**
   * How the list is ordered.
   *
   * `status` sorts in LIFECYCLE order, not alphabetically: the column is a
   * Postgres enum declared PENDING_ASSIGNMENT -> ASSIGNED ->
   * LOADING_IN_PROGRESS -> COMPLETED -> CANCELLED, and Postgres sorts an enum
   * by its declaration order. Ascending therefore puts what still needs doing
   * at the top, which is the only ordering of a status that means anything.
   *
   * Ties break on `createdAt` descending so a page cannot shuffle between two
   * requests for rows that sort equally.
   */
  private listOrderBy(query: WaybillListQueryDto) {
    const direction: Prisma.SortOrder =
      query.sortOrder === 'asc' ? 'asc' : 'desc';
    switch (query.sortBy) {
      case 'status':
        return [{ status: direction }, { createdAt: 'desc' as const }];
      case 'requestedLoadingDate':
        return [
          { requestedLoadingDate: direction },
          { createdAt: 'desc' as const },
        ];
      default:
        return [{ createdAt: direction }];
    }
  }

  /**
   * The account officers looking after this distributor.
   *
   * A distributor can have more than one: `assignedOfficerId` names the
   * primary, and `CustomerOfficer` carries the rest. The primary comes first
   * and is flagged, because "who do I talk to" has one answer even when
   * several people can help.
   *
   * ACCOUNT officers are named to the distributor - it is who they chat with.
   * The LOADING officer on a request is not (PRD F6), and is not in here.
   */
  private async accountOfficersOf(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        assignedOfficerId: true,
        assignedOfficer: {
          select: { id: true, name: true, email: true, phone: true },
        },
        officerAssignments: {
          select: {
            staff: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });
    if (!customer) return [];

    const officers: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      isPrimary: boolean;
    }[] = [];
    const seen = new Set<string>();
    const add = (
      staff: {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
      } | null,
      isPrimary: boolean,
    ) => {
      if (!staff || seen.has(staff.id)) return;
      seen.add(staff.id);
      officers.push({ ...staff, isPrimary });
    };
    add(customer.assignedOfficer, true);
    for (const assignment of customer.officerAssignments) {
      add(assignment.staff, false);
    }
    return officers;
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
    const { items, ...rest } = wb;
    const linkedPurchaseIds = linkedPurchaseIdsOf(wb.linkedPurchaseId, items);

    // The orders themselves, so the preview can name each one rather than
    // showing a bare uuid. Scoped to this request's own orders.
    const purchases = await this.prisma.purchase.findMany({
      where: { id: { in: linkedPurchaseIds } },
      select: {
        id: true,
        erpId: true,
        orderDate: true,
        status: true,
        totalItems: true,
        totalValue: true,
      },
    });
    const byId = new Map(purchases.map((p) => [p.id, p]));

    // A line written before multi-order support has no purchaseId: it belonged
    // to the request's single linked order, so read it there.
    const orderIdOf = (line: LoadingRequestLine) =>
      line.purchaseId ?? wb.linkedPurchaseId;

    // A request raised before the product breakdown existed declares a bare
    // `quantityCartons` and has no lines. Deriving 0 from them would read as
    // an empty load, so the declared figure stands in - those requests were
    // always against the one linked order.
    const declaredOnly = items.length === 0;
    const declaredTotals = {
      productLines: 0,
      totalCartons: wb.quantityCartons ?? 0,
      totalWeightKg: 0,
      // No lines means no carton weights: the weight is unknown, not zero.
      weightIsComplete: false,
    };

    const orders = linkedPurchaseIds.map((purchaseId) => {
      const purchase = byId.get(purchaseId);
      const lines = items.filter((line) => orderIdOf(line) === purchaseId);
      const isPrimary = purchaseId === wb.linkedPurchaseId;
      return {
        purchaseId,
        // `orderReference` is denormalised onto the line, so the DOC_NO
        // survives even if the local order row is gone.
        erpId:
          purchase?.erpId ??
          lines.find((l) => l.orderReference)?.orderReference ??
          null,
        orderDate: purchase?.orderDate ?? null,
        orderStatus: purchase?.status ?? null,
        orderTotalItems: purchase?.totalItems ?? null,
        orderTotalValue: purchase?.totalValue ?? null,
        isPrimary,
        ...(declaredOnly && isPrimary ? declaredTotals : totalsOf(lines)),
        products: lines,
      };
    });

    return {
      ...rest,
      linkedPurchaseIds,
      // The load broken down per order - what the distributor actually
      // submitted, regrouped. `products` below stays flat for callers that
      // already read it.
      orders,
      totals: {
        orders: orders.length,
        ...(declaredOnly ? declaredTotals : totalsOf(items)),
      },
      // Named `products` on the wire, matching the submit body; `items` is
      // only the Prisma relation name.
      products: items,
      // PRD F6: customers never see an officer's real name — surface a generic
      // label, never the assigned loading officer's identity.
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
    linkedPurchaseId: string | string[] | undefined,
  ): Promise<{ id: string; erpId: string }[]> {
    // The form no longer names an order: the distributor picks products, and
    // the request is filed against the ACCOUNT. An order id is still accepted
    // - older clients send one, and it makes the reference match the ERP
    // document - but its absence is not an error.
    if (linkedPurchaseId === undefined || linkedPurchaseId === null) return [];
    const isList = Array.isArray(linkedPurchaseId);
    const raw = isList ? linkedPurchaseId : [linkedPurchaseId];
    if (raw.length === 0) return [];
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
  ): Promise<LoadingLine[]> {
    for (const product of dto.products ?? []) {
      if (product.quantityToLoad == null && product.quantity == null) {
        throw new BadRequestException(
          `"${product.productName}" states no quantityToLoad.`,
        );
      }
    }

    const toLine = (
      p: LoadingRequestProductDto,
      order: { id: string; erpId: string } | null,
    ) => ({
      purchaseId: order?.id ?? null,
      orderReference: order?.erpId ?? null,
      productId: p.productId ?? null,
      productName: p.productName,
      spec: p.spec ?? null,
      quantityLeft: p.quantityLeft ?? null,
      // `quantityToLoad` is the field the form sends; `quantity` was its
      // former name and is still accepted so older clients keep working.
      quantity: quantityOf(p),
      weightPerCarton: p.weightPerCarton ?? null,
    });

    const primary = linked[0] ?? null;
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
        const stated = product?.quantityToLoad ?? product?.quantity;
        if (!product?.productName || typeof stated !== 'number') {
          throw new BadRequestException(
            `orders["${key}"] contains a line without a productName or quantity.`,
          );
        }
        if (stated < 1) {
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
   * Total weight of a load: SUM(quantity x weight per carton).
   *
   * The weight is taken from the line as sent - the distributor echoes it
   * back from GET /erp/orders/{orderId}/products - and FALLS BACK to the Viju
   * specification sheet when the line carries none. Without that fallback,
   * omitting `weightPerCarton` would silently skip the capacity check for
   * that product.
   *
   * The fallback is used for THIS CHECK ONLY. What gets stored is still
   * exactly what the distributor declared: a later correction to the sheet
   * must not rewrite their record.
   */
  private weighLoad(
    lines: {
      productName: string;
      quantity: number;
      weightPerCarton: number | null;
    }[],
  ): LoadWeight {
    let totalWeightKg = 0;
    let unweighed = 0;
    for (const line of lines) {
      const perCarton =
        line.weightPerCarton ??
        resolveProduct(line.productName, null).weightPerCarton;
      if (perCarton === null || perCarton <= 0) {
        unweighed++;
        continue;
      }
      totalWeightKg += line.quantity * perCarton;
    }
    // Kilograms to 2dp: the sheet states carton weights to 2dp, and a raw
    // float sum would put noise into the error message.
    return { totalWeightKg: Math.round(totalWeightKg * 100) / 100, unweighed };
  }

  /**
   * `loadingCapacity` must EQUAL the weight of the load.
   *
   *   total weight = SUM(quantityToLoad x weightPerCarton)
   *
   * The field is not a truck's rated capacity that the load has to fit inside:
   * the form computes the load's weight and sends it, and this confirms the
   * two agree. A form that miscounts, or a client that edits the products
   * without recomputing, is caught here rather than filing a request whose
   * stated weight is not the weight of what it lists.
   *
   * Compared at 2dp, because both sides are sums of two-decimal kilograms and
   * binary floating point does not make 20 x 2.7 exactly 54.
   *
   * A load with lines nothing can weigh is LET THROUGH: the check would
   * otherwise reject on a total it cannot stand behind. Nothing is written
   * until this passes, so a rejection leaves no half-made request behind.
   */
  private assertCapacityMatchesLoad(
    loadingCapacity: number | undefined,
    lines: LoadingLine[],
  ): void {
    if (loadingCapacity == null || lines.length === 0) return;
    const { totalWeightKg, unweighed } = this.weighLoad(lines);
    if (unweighed > 0) return;
    if (Math.abs(totalWeightKg - loadingCapacity) < 0.01) return;
    const difference =
      Math.round((totalWeightKg - loadingCapacity) * 100) / 100;
    throw new BadRequestException(
      `The products weigh ${totalWeightKg}kg but loadingCapacity says ` +
        `${loadingCapacity}kg - a difference of ${Math.abs(difference)}kg. ` +
        `loadingCapacity must equal the sum of quantityToLoad x ` +
        `weightPerCarton across every product.`,
    );
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

    // A distributor may state their own id, and only their own. Ignoring a
    // wrong one would file the request against the wrong account without
    // anyone noticing; refusing says so out loud.
    if (dto.customerId && dto.customerId !== customerId) {
      throw new ForbiddenException(
        'customerId does not match the signed-in distributor. Omit it, or ' +
          'send your own id.',
      );
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, erpId: true, region: true, name: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // The first is the PRIMARY order, when one is named: the request is filed
    // under it and its DOC_NO becomes the reference. The form no longer sends
    // one, so this is usually empty.
    const linkedOrders = await this.resolveLinkedOrders(
      customerId,
      dto.linkedPurchaseId,
    );
    const purchase = linkedOrders[0] ?? null;

    const lines = await this.resolveOrderLines(customerId, dto, linkedOrders);
    // `loadingCapacity` is the TRUCK's capacity, not the load. The load is the
    // sum of the product lines ACROSS EVERY ORDER, and it is mirrored onto
    // `quantityCartons` so every existing stock calculation - which reads that
    // column on COMPLETED requests - keeps working without knowing about
    // product lines.
    const loadedCartons = lines.reduce((sum, l) => sum + l.quantity, 0);

    // A loading request that loads nothing is not a request. Checked here
    // rather than on the DTO because either `products` or `orders` may carry
    // the lines, and the validator can only see one field at a time.
    if (lines.length === 0) {
      throw new BadRequestException(
        'products must contain at least one product to load.',
      );
    }

    this.assertCapacityMatchesLoad(dto.loadingCapacity, lines);

    // WHAT THE REFERENCE IS DRAWN FROM. When the request names an order, its
    // DOC_NO - so the reference can be matched against the ERP by eye. The
    // form no longer names one, so the fallback is the distributor's own ERP
    // code and the date, which is still recognisable and still unique once
    // the -02 suffix settles same-day collisions.
    const referenceBase = purchase
      ? purchase.erpId
      : `LR-${customer.erpId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

    const request = await this.createWithOrderReference(referenceBase, {
      customerId,
      region: customer.region,
      linkedPurchaseId: purchase?.id ?? null,
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
