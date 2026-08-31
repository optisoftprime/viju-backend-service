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

export class WaybillListLinkedPurchaseDto {
  @ApiProperty({ example: 'VJ-2026-675' })
  erpId: string;
}

/**
 * One product line on a loading request - what the distributor declared they
 * were loading, stored as sent.
 */
export class WaybillProductDto {
  @ApiProperty({ example: 'item-uuid-1' })
  id: string;

  @ApiProperty({
    example: '56d62263-6cab-4e6f-b98c-91f50fa1f61d',
    nullable: true,
    description:
      'The order this line was taken from. One loading request can span ' +
      'several orders, so group on this rather than assuming they all belong ' +
      'to `linkedPurchaseId`. Null on lines predating multi-order support.',
  })
  purchaseId: string | null;

  @ApiProperty({
    example: '2310-202606110033',
    nullable: true,
    description: 'The ERP DOC_NO of that order - what to show the distributor.',
  })
  orderReference: string | null;

  @ApiProperty({
    example: '101020104',
    nullable: true,
    description:
      'ERP item code. Null when the product specification sheet does not ' +
      'cover this product.',
  })
  productId: string | null;

  @ApiProperty({ example: '750ml water(L-水)' })
  productName: string;

  @ApiProperty({ example: 120, description: 'Cartons of this product.' })
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

export class WaybillListItemDto {
  @ApiProperty({ example: 'waybill-uuid-1' })
  id: string;

  @ApiProperty({ example: 'WB-123456' })
  reference: string;

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

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'PENDING_ASSIGNMENT',
  })
  status: LoadingRequestStatus;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

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

  @ApiProperty({ type: WaybillListLinkedPurchaseDto, nullable: true })
  linkedPurchase: WaybillListLinkedPurchaseDto | null;
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

export class WaybillDetailDto extends WaybillDto {
  @ApiProperty({ type: WaybillDetailLinkedPurchaseDto, nullable: true })
  linkedPurchase: WaybillDetailLinkedPurchaseDto | null;

  @ApiProperty({
    type: CustomerWaybillAssignedOfficerDto,
    nullable: true,
    description: 'Present (masked) once a loading officer is assigned',
  })
  assignedOfficer: CustomerWaybillAssignedOfficerDto | null;
}
