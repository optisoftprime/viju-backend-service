import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';
import { API_LOADING_STATUS_VALUES, ApiLoadingStatus } from '../loading-status';
import { CancelledByDto } from '../../regional/dto/regional-response.dto';

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

  @ApiProperty({
    example: 'customer loading 800 cartons, 200 remaining',
    nullable: true,
    description:
      'L-2 — the loading officer’s note. Null when none was written.',
  })
  description: string | null;

  @ApiProperty({
    example: '2026-08-28T09:14:02.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'TS-1 — when the note was last written. NOT `updatedAt`, which every ' +
      'status change bumps.',
  })
  descriptionUpdatedAt: Date | null;

  @ApiProperty({
    example: '2026-08-28T11:34:41.751Z',
    format: 'date-time',
    nullable: true,
    description: 'L-1 — when the load was called off. Null on a live load.',
  })
  cancelledAt: Date | null;

  @ApiProperty({
    example: 'distributor rescheduled',
    nullable: true,
    description: 'L-1 — why, when a reason was given.',
  })
  cancelReason: string | null;

  @ApiProperty({
    type: CancelledByDto,
    nullable: true,
    description:
      'CB-1 — who called the load off, with their role as the wire enum. ' +
      'Null on a live load.',
  })
  cancelledBy: CancelledByDto | null;
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

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
    description: 'L-1 — set when this call cancelled the load.',
  })
  cancelledAt: Date | null;

  @ApiProperty({ example: null, nullable: true })
  cancelReason: string | null;

  @ApiProperty({
    type: CancelledByDto,
    nullable: true,
    description:
      'CB-1 — the loading officer cancels through this route rather than a ' +
      '/cancel one, so the actor is returned here too.',
  })
  cancelledBy: CancelledByDto | null;
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
