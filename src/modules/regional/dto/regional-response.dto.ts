import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';
import {
  API_LOADING_STATUS_VALUES,
  ApiLoadingStatus,
} from '../../loading/loading-status';

const LOADING_REQUEST_STATUS_VALUES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'LOADING_IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
type LoadingRequestStatus = (typeof LOADING_REQUEST_STATUS_VALUES)[number];

// ─── Shared row shape for the regional loading screens ─────

/** The loading officer a request is assigned to, when there is one. */
export class RegionalAssignedOfficerDto {
  @ApiProperty({ example: 'staff-uuid-11' })
  id: string;

  @ApiProperty({ example: 'Ifeanyi Okon' })
  name: string;
}

/**
 * One loading request as the regional screens render it (RA-02, RA-06).
 *
 * Returned by the dashboard's pending queue, the loading-requests list, the
 * assign mutation and the status mutation, so the FE has a single row shape
 * to bind to.
 */
export class RegionalLoadingRequestDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'WB-19045',
    description: 'Waybill reference issued by this platform',
  })
  waybill: string;

  @ApiProperty({
    example: 'ORD-00294',
    description:
      'ERP reference of the order being loaded. Falls back to the waybill ' +
      'reference when the request is not linked to an order.',
  })
  reference: string;

  @ApiProperty({ example: 'Bello & Sons LTD' })
  distributorName: string;

  @ApiProperty({
    example: 'purchase-uuid-1',
    nullable: true,
    description: 'Id of the linked order, null when there is none',
  })
  orderId: string | null;

  @ApiProperty({ example: 'LAG-234-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'John Dare' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({ example: 320, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({
    example: '2026-08-20T14:00:00.000Z',
    format: 'date-time',
    description: 'Loading date the distributor requested',
  })
  loadingDate: Date;

  @ApiProperty({
    example: '2026-08-19T09:00:00.000Z',
    format: 'date-time',
    description: 'When the request was submitted',
  })
  submittedAt: Date;

  @ApiProperty({
    enum: API_LOADING_STATUS_VALUES,
    example: 'PENDING',
    description:
      'Portal vocabulary, matching the filter tabs. PENDING is stored as ' +
      'PENDING_ASSIGNMENT and IN_PROGRESS as LOADING_IN_PROGRESS.',
  })
  status: ApiLoadingStatus;

  @ApiProperty({ type: RegionalAssignedOfficerDto, nullable: true })
  assignedOfficer: RegionalAssignedOfficerDto | null;
}

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

  @ApiProperty({
    type: [RegionalLoadingRequestDto],
    description:
      'Requests still awaiting assignment in this region, oldest first ' +
      '(capped at 50). Empty until distributors start submitting loading ' +
      'requests.',
  })
  pendingLoadingRequests: RegionalLoadingRequestDto[];
}

// ─── Full LoadingRequest (PATCH assign / PATCH status) ─────

/**
 * Full LoadingRequest scalar shape returned by the assign and
 * status-update mutations (Prisma `update` with no relation includes).
 */
export class RegionalLoadingRequestFullDto {
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

export class PaginatedLoadingRequestsResponseDto {
  @ApiProperty({ type: [RegionalLoadingRequestDto] })
  data: RegionalLoadingRequestDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Officer queue (GET /regional/my-loading-queue) ────────

/**
 * Queue item: all scalar fields plus customer.name and
 * linkedPurchase.erpId (assignedOfficer is NOT included here).
 */
export class RegionalLoadingQueueItemDto extends RegionalLoadingRequestFullDto {
  @ApiProperty({ type: CustomerNameDto })
  customer: CustomerNameDto;

  @ApiProperty({ type: LinkedPurchaseErpDto, nullable: true })
  linkedPurchase: LinkedPurchaseErpDto | null;
}

export class PaginatedRegionalLoadingQueueResponseDto {
  @ApiProperty({ type: [RegionalLoadingQueueItemDto] })
  data: RegionalLoadingQueueItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
