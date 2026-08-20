import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';
import { API_LOADING_STATUS_VALUES, ApiLoadingStatus } from '../loading-status';

// ─── GET /loading/queue ────────────────────────────────────

/** One row of the loading officer's queue (LO-02). */
export class LoadingQueueItemDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'ORD-0099',
    nullable: true,
    description: 'erpId of the linked order, null when the load has none',
  })
  orderId: string | null;

  @ApiProperty({ example: 'Ibonodu Mega Distributor' })
  distributorName: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({
    example: '2026-08-19T10:10:00.000Z',
    format: 'date-time',
    description: 'When the distributor submitted the loading request',
  })
  submittedAt: Date;

  @ApiProperty({ enum: API_LOADING_STATUS_VALUES, example: 'ASSIGNED' })
  status: ApiLoadingStatus;
}

export class PaginatedLoadingQueueResponseDto {
  @ApiProperty({ type: [LoadingQueueItemDto] })
  data: LoadingQueueItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── GET /loading/queue/:id ────────────────────────────────

/** Detail panel for one assignment (LO-03). */
export class LoadingQueueDetailDto extends LoadingQueueItemDto {
  @ApiProperty({ example: 'RJ-290' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'John Dare' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({
    example: '2026-08-20T09:00:00.000Z',
    format: 'date-time',
    description: 'Loading date the distributor requested',
  })
  loadingDate: Date;

  @ApiProperty({ example: 320, nullable: true })
  quantityCartons: number | null;

  @ApiProperty({
    example: 'Yaba Warehouse',
    nullable: true,
    description: 'Delivery destination, when the distributor supplied one',
  })
  destination: string | null;

  @ApiProperty({
    example: 'WB-19045',
    description: 'Waybill / loading-request reference',
  })
  reference: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/.../proof.jpg',
    nullable: true,
    description: 'Proof of loading, once recorded',
  })
  attachmentUrl: string | null;
}

// ─── PATCH /loading/queue/:id/status ───────────────────────

export class LoadingStatusUpdatedDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({ enum: API_LOADING_STATUS_VALUES, example: 'IN_PROGRESS' })
  status: ApiLoadingStatus;

  @ApiProperty({ example: '2026-08-19T11:02:00.000Z', format: 'date-time' })
  updatedAt: Date;
}

// ─── POST /loading/queue/:id/waybill ───────────────────────

/**
 * The recorded waybill (LO-05).
 *
 * A waybill is not a separate table: the LoadingRequest IS the waybill record
 * in this schema — it already carries the truck, driver, quantity and the
 * `WB-…` reference, and it is what GET /officers/customers/{id}/waybills
 * reads back. `id` and `loadingRequestId` therefore refer to the same row.
 */
export class RecordedWaybillDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({ example: 'WB-19045' })
  waybillNumber: string;

  @ApiProperty({
    example: 'loading-request-uuid-1',
    description: 'Same row as `id` — the loading request this waybill records',
  })
  loadingRequestId: string;

  @ApiProperty({ example: 'LAG-234-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'John Dare' })
  driverName: string;

  @ApiProperty({ example: 320 })
  quantityCartons: number | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/.../proof.jpg',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ enum: API_LOADING_STATUS_VALUES, example: 'COMPLETED' })
  status: ApiLoadingStatus;

  @ApiProperty({ example: '2026-08-19T11:20:00.000Z', format: 'date-time' })
  createdAt: Date;
}
