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

// ─── Dashboard (GET /regional/dashboard) ───────────────────

export class RegionalDashboardSummaryDto {
  @ApiProperty({
    example: 42,
    description: 'Distributors (customers) in region',
  })
  totalDistributors: number;

  @ApiProperty({ example: 5, description: 'Open support tickets in region' })
  openTickets: number;

  @ApiProperty({
    example: 3,
    description: 'Loading requests pending assignment',
  })
  pendingWaybills: number;

  @ApiProperty({
    example: 4,
    description: 'Active officers (role OFFICER) in region',
  })
  activeOfficers: number;
}

export class PendingLoadingRequestDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({ example: 'LR-2026-000123' })
  reference: string;

  @ApiProperty({ example: 'Acme Distributors Ltd' })
  distributorName: string;

  @ApiProperty({
    example: 'ERP-PO-00045',
    nullable: true,
    description: 'erpId of the linked purchase order, if any',
  })
  orderId: string | null;

  @ApiProperty({ example: '2026-06-12T08:00:00.000Z', format: 'date-time' })
  loadingDate: Date;

  @ApiProperty({ example: 'LAG-123-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'Emeka Okafor' })
  driverName: string;

  @ApiProperty({ example: 120, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'PENDING_ASSIGNMENT',
  })
  status: LoadingRequestStatus;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  submittedAt: Date;
}

export class RegionalDashboardResponseDto {
  @ApiProperty({ type: RegionalDashboardSummaryDto })
  summary: RegionalDashboardSummaryDto;

  @ApiProperty({ type: [PendingLoadingRequestDto] })
  pendingLoadingRequests: PendingLoadingRequestDto[];
}

// ─── Full LoadingRequest (PATCH assign / PATCH status) ─────

/**
 * Full LoadingRequest scalar shape returned by the assign and
 * status-update mutations (Prisma `update` with no relation includes).
 */
export class LoadingRequestDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({ example: 'LR-2026-000123' })
  reference: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ example: 'purchase-uuid-1', nullable: true })
  linkedPurchaseId: string | null;

  @ApiProperty({ example: 'LAG-123-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'Emeka Okafor' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({ example: '2026-06-12T08:00:00.000Z', format: 'date-time' })
  requestedLoadingDate: Date;

  @ApiProperty({ example: 120, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({ example: 'Ikeja Warehouse', nullable: true })
  destination: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  termsAcceptedAt: Date;

  @ApiProperty({
    example: 'https://forms.example/loading/LR-2026-000123',
    nullable: true,
  })
  externalFormUrl: string | null;

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'ASSIGNED',
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
    example: 'https://cdn.viju.example/waybills/LR-2026-000123.pdf',
    nullable: true,
  })
  waybillDocumentUrl: string | null;

  @ApiProperty({ example: 'Loaded without issue', nullable: true })
  notes: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

// ─── Paginated list (GET /regional/loading-requests) ───────

export class CustomerNameDto {
  @ApiProperty({ example: 'Acme Distributors Ltd' })
  name: string;
}

export class AssignedOfficerNameDto {
  @ApiProperty({ example: 'John Doe' })
  name: string;
}

export class LinkedPurchaseErpDto {
  @ApiProperty({ example: 'ERP-PO-00045' })
  erpId: string;
}

/**
 * LoadingRequest list item: all scalar fields plus the selected
 * relation slivers (customer.name, assignedOfficer.name, linkedPurchase.erpId).
 */
export class LoadingRequestListItemDto extends LoadingRequestDto {
  @ApiProperty({ type: CustomerNameDto })
  customer: CustomerNameDto;

  @ApiProperty({ type: AssignedOfficerNameDto, nullable: true })
  assignedOfficer: AssignedOfficerNameDto | null;

  @ApiProperty({ type: LinkedPurchaseErpDto, nullable: true })
  linkedPurchase: LinkedPurchaseErpDto | null;
}

export class PaginatedLoadingRequestsResponseDto {
  @ApiProperty({ type: [LoadingRequestListItemDto] })
  data: LoadingRequestListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Officer queue (GET /regional/my-loading-queue) ────────

/**
 * Queue item: all scalar fields plus customer.name and
 * linkedPurchase.erpId (assignedOfficer is NOT included here).
 */
export class LoadingQueueItemDto extends LoadingRequestDto {
  @ApiProperty({ type: CustomerNameDto })
  customer: CustomerNameDto;

  @ApiProperty({ type: LinkedPurchaseErpDto, nullable: true })
  linkedPurchase: LinkedPurchaseErpDto | null;
}

export class PaginatedLoadingQueueResponseDto {
  @ApiProperty({ type: [LoadingQueueItemDto] })
  data: LoadingQueueItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
