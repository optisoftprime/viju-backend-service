import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const LOADING_REQUEST_STATUS_VALUES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'LOADING_IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
type LoadingRequestStatus = (typeof LOADING_REQUEST_STATUS_VALUES)[number];

// ─── List item (GET /customers/me/waybills) ───────────────────
// Backed by loadingRequest.findMany with an explicit `select`.

/**
 * One product line on a loading request - what the distributor declared they
 * were loading, stored as sent.
 */
export class WaybillProductDto {
  @ApiProperty({
    example: '0af9fc77-969c-4f65-b5ae-ed8e683f5563',
    description:
      'The id of the first stored line behind this row. A row is one PRODUCT, ' +
      'and several lines can merge into it, so this is not a key you can edit ' +
      'or delete by.',
  })
  id: string;

  @ApiProperty({
    example: '101020104',
    nullable: true,
    description:
      'ERP item code. Null when the product specification sheet does not ' +
      'cover this product.',
  })
  productId: string | null;

  @ApiProperty({ example: 'Mr V Premium Table Water(Abuja)' })
  productName: string;

  @ApiProperty({
    example: '100ML',
    nullable: true,
    description:
      'ITEM_SPECIFICATION as the products endpoint returned it. Null on lines ' +
      'raised before it was recorded.',
  })
  spec: string | null;

  @ApiProperty({
    example: 20,
    description:
      'Cartons of this product, ADDED UP across every line that carries it. ' +
      'A request can hold one product on several lines - taken from two ' +
      'orders, or entered twice - and they are merged into one row here.',
  })
  quantity: number;

  @ApiProperty({
    example: 9.38,
    nullable: true,
    description:
      'Kilograms per carton. Null when the sheet does not cover this ' +
      'product - check before doing arithmetic.',
  })
  weightPerCarton: number | null;
}

/** An account officer looking after the distributor. */
export class WaybillAccountOfficerDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Funmi Adelaja' })
  name: string;

  @ApiProperty({ example: 'funmi@viju.example', nullable: true })
  email: string | null;

  @ApiProperty({ example: '+2348012345678', nullable: true })
  phone: string | null;

  @ApiProperty({
    example: true,
    description:
      'The primary officer, listed first. Exactly one is primary; the rest ' +
      'are secondary assignments.',
  })
  isPrimary: boolean;
}

export class WaybillListItemDto {
  @ApiProperty({ example: 'waybill-uuid-1' })
  id: string;

  @ApiProperty({ example: '2310-202606110033' })
  reference: string;

  @ApiProperty({ example: 'f4065cfe-682e-4864-9e7a-49e0a3b0f244' })
  customerId: string;

  @ApiProperty({
    type: [WaybillAccountOfficerDto],
    description:
      'The ACCOUNT officers assigned to this distributor, primary first. ' +
      'Empty when nobody is assigned.\n\n' +
      'These are the people the distributor deals with and may be named. The ' +
      'LOADING officer on the request is a different person and is NEVER ' +
      'named to a customer (PRD F6) - see `assignedOfficer` on the detail ' +
      'route, which is always the label "Viju Loading Officer".',
  })
  accountOfficers: WaybillAccountOfficerDto[];

  @ApiProperty({ example: 'LAG-234-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'Jimoh Ibrahim' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({ example: '2026-06-15T00:00:00.000Z', format: 'date-time' })
  requestedLoadingDate: Date;

  @ApiProperty({ example: 320, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({ example: 'Yaba Warehouse', nullable: true })
  destination: string | null;

  @ApiProperty({
    enum: ['LAGOS WAREHOUSE', 'OGUN WAREHOUSE', 'ABUJA WAREHOUSE'],
    example: 'LAGOS WAREHOUSE',
    nullable: true,
    description: 'Null on requests raised before this field existed.',
  })
  warehouseName: string | null;

  @ApiProperty({
    example: 1200,
    nullable: true,
    description:
      'The TRUCK’s carton capacity, not the size of this load. The load is ' +
      'the sum of `products[].quantity`, mirrored onto `quantityCartons`.',
  })
  loadingCapacity: number | null;

  @ApiProperty({
    type: [WaybillProductDto],
    description:
      'The products declared on this load, ONE ROW PER PRODUCT. Empty on ' +
      'requests raised without a breakdown, and on any predating the field.',
  })
  products: WaybillProductDto[];

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'PENDING_ASSIGNMENT',
  })
  status: LoadingRequestStatus;

  @ApiProperty({
    example: 'Loaded 18 of 20 pallets; the rest follow tomorrow.',
    nullable: true,
    description:
      'What the LOADING officer wrote about this load. Null until one writes ' +
      'something.',
  })
  description: string | null;

  @ApiProperty({
    example: 'Truck failed inspection at the gate.',
    nullable: true,
    description:
      'Why a regional admin or account officer cancelled the request. Null ' +
      'unless `status` is CANCELLED.',
  })
  cancelReason: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

export class PaginatedWaybillsResponseDto {
  @ApiProperty({ type: [WaybillListItemDto] })
  data: WaybillListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Accept T&C (POST /customers/me/waybills/accept-terms) ─────

export class AcceptTermsResponseDto {
  @ApiProperty({ example: 'https://forms.example.com/viju-loading' })
  formUrl: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  acceptedAt: Date;

  @ApiProperty({
    example:
      'Open this URL in a browser / in-app web view. Form submission triggers the regional admin assignment flow.',
  })
  note: string;
}

// ─── Submit (POST /customers/me/waybills) ──────────────────────
// Backed by loadingRequest.create — full model record, no relations.

export class WaybillDto {
  @ApiProperty({ example: 'waybill-uuid-1' })
  id: string;

  @ApiProperty({ example: 'WB-123456' })
  reference: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({
    example: 'f7a86c0a-1ee9-40d0-85a0-5334f6da100c',
    nullable: true,
    description:
      'The PRIMARY order - the one the request is filed under and whose ' +
      'DOC_NO became `reference`. See `linkedPurchaseIds` for the full set.',
  })
  linkedPurchaseId: string | null;

  @ApiProperty({
    type: [String],
    example: [
      'f7a86c0a-1ee9-40d0-85a0-5334f6da100c',
      'ea95bb9e-e470-4743-ab20-618841ea9abf',
    ],
    description:
      'EVERY order this request draws on, primary first. One truck loads ' +
      'from several sales orders, so read this rather than `linkedPurchaseId` ' +
      'when showing which orders are on the load. Single-entry on requests ' +
      'raised against one order.',
  })
  linkedPurchaseIds: string[];

  @ApiProperty({ example: 'LAG-234-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'Jimoh Ibrahim' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({ example: '2026-06-15T00:00:00.000Z', format: 'date-time' })
  requestedLoadingDate: Date;

  @ApiProperty({ example: 320, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({ example: 'Yaba Warehouse', nullable: true })
  destination: string | null;

  @ApiProperty({
    enum: ['LAGOS WAREHOUSE', 'OGUN WAREHOUSE', 'ABUJA WAREHOUSE'],
    example: 'LAGOS WAREHOUSE',
    nullable: true,
    description: 'Null on requests raised before this field existed.',
  })
  warehouseName: string | null;

  @ApiProperty({
    example: 1200,
    nullable: true,
    description:
      'The TRUCK’s carton capacity, not the size of this load. The load is ' +
      'the sum of `products[].quantity`, mirrored onto `quantityCartons`.',
  })
  loadingCapacity: number | null;

  @ApiProperty({
    type: [WaybillProductDto],
    description:
      'The products declared on this load. Empty on requests raised without ' +
      'a breakdown, and on any predating the field.',
  })
  products: WaybillProductDto[];

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  termsAcceptedAt: Date;

  @ApiProperty({
    example: 'https://forms.example.com/viju-loading',
    nullable: true,
  })
  externalFormUrl: string | null;

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'PENDING_ASSIGNMENT',
  })
  status: LoadingRequestStatus;

  @ApiProperty({ example: 'officer-uuid-1', nullable: true })
  assignedOfficerId: string | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  assignedAt: Date | null;

  @ApiProperty({ example: 'admin-uuid-1', nullable: true })
  assignedById: string | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  loadingStartedAt: Date | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  completedAt: Date | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/waybills/WB-123456.pdf',
    nullable: true,
  })
  waybillDocumentUrl: string | null;

  @ApiProperty({ example: 'Customer requested early pickup', nullable: true })
  notes: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

// ─── Detail (GET /customers/me/waybills/:id) ───────────────────
// Full model record + linkedPurchase {id, erpId} + masked assignedOfficer.

export class WaybillDetailLinkedPurchaseDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-2026-675' })
  erpId: string;
}

export class CustomerWaybillAssignedOfficerDto {
  @ApiProperty({
    example: 'Viju Loading Officer',
    description: 'Generic label — customers never see the officer’s real name',
  })
  displayName: string;
}

/**
 * One order on the load, with the lines taken from it.
 *
 * A loading request can draw on several sales orders, so the detail view
 * groups the flat `products` array by order - this is that grouping, with the
 * order's own particulars attached so the screen can name it.
 */
export class WaybillOrderBreakdownDto {
  @ApiProperty({ example: 'f7a86c0a-1ee9-40d0-85a0-5334f6da100c' })
  purchaseId: string;

  @ApiProperty({
    example: '2300-202606110059',
    nullable: true,
    description: 'The ERP DOC_NO - what to show the distributor.',
  })
  erpId: string | null;

  @ApiProperty({
    example: '2026-06-11T00:00:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  orderDate: Date | null;

  @ApiProperty({ example: 'CLOSED', nullable: true })
  orderStatus: string | null;

  @ApiProperty({
    example: 2860,
    nullable: true,
    description: 'Cartons on the ORDER as a whole - not on this load.',
  })
  orderTotalItems: number | null;

  @ApiProperty({ example: 4084000, nullable: true })
  orderTotalValue: number | null;

  @ApiProperty({
    example: true,
    description:
      'The order the request is filed under, and whose DOC_NO became ' +
      '`reference`. Exactly one order is the primary.',
  })
  isPrimary: boolean;

  @ApiProperty({ example: 2, description: 'Product lines from this order.' })
  productLines: number;

  @ApiProperty({ example: 200, description: 'Cartons taken from this order.' })
  totalCartons: number;

  @ApiProperty({
    example: 1631.0,
    description: 'Kilograms taken from this order. See `weightIsComplete`.',
  })
  totalWeightKg: number;

  @ApiProperty({
    example: true,
    description:
      'False when a line here has no carton weight, so the kilogram figure ' +
      'is a partial sum. Render it as a minimum, or as a dash.',
  })
  weightIsComplete: boolean;

  @ApiProperty({ type: [WaybillProductDto] })
  products: WaybillProductDto[];
}

/** The load as a whole, across every order. */
export class WaybillTotalsDto {
  @ApiProperty({ example: 2, description: 'Orders this load draws on.' })
  orders: number;

  @ApiProperty({ example: 3 })
  productLines: number;

  @ApiProperty({
    example: 210,
    description: 'Cartons on the load. Equals `quantityCartons`.',
  })
  totalCartons: number;

  @ApiProperty({ example: 1747.0 })
  totalWeightKg: number;

  @ApiProperty({
    example: true,
    description: 'False when any line on the load has no carton weight.',
  })
  weightIsComplete: boolean;
}

export class WaybillDetailDto extends WaybillDto {
  @ApiProperty({
    type: [WaybillOrderBreakdownDto],
    description:
      'The load broken down PER ORDER, primary first - the shape the request ' +
      'was submitted in, rebuilt. `products` on the parent stays flat for ' +
      'callers that already read it; these are the same lines, grouped.',
  })
  orders: WaybillOrderBreakdownDto[];

  @ApiProperty({ type: WaybillTotalsDto })
  totals: WaybillTotalsDto;

  @ApiProperty({ type: WaybillDetailLinkedPurchaseDto, nullable: true })
  linkedPurchase: WaybillDetailLinkedPurchaseDto | null;

  @ApiProperty({
    type: CustomerWaybillAssignedOfficerDto,
    nullable: true,
    description: 'Present (masked) once a loading officer is assigned',
  })
  assignedOfficer: CustomerWaybillAssignedOfficerDto | null;
}
