import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/** Statuses a loading officer's own queue can be filtered by (LO-02). */
export const QUEUE_STATUS_VALUES = [
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;
export type QueueStatus = (typeof QUEUE_STATUS_VALUES)[number];

/** Statuses a loading officer can move a load to (LO-04). */
export const QUEUE_STATUS_TRANSITIONS = ['IN_PROGRESS', 'COMPLETED'] as const;

/**
 * Query params for GET /loading/queue. The officer is always taken from the
 * token — there is deliberately no officerId param, so one loading officer
 * cannot read another's work.
 */
export class LoadingQueueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: QUEUE_STATUS_VALUES,
    description:
      'Filter to one state. Omit for the whole queue (assigned, in progress ' +
      'and completed), which is what the FE groups by state.',
  })
  @IsOptional()
  @IsIn(QUEUE_STATUS_VALUES)
  status?: QueueStatus;
}

/** Body for PATCH /loading/queue/:id/status (LO-04). */
export class UpdateQueueStatusDto {
  @ApiProperty({
    enum: QUEUE_STATUS_TRANSITIONS,
    example: 'IN_PROGRESS',
    description:
      'The state to advance to. ASSIGNED -> IN_PROGRESS -> COMPLETED; any ' +
      'other move (including reopening a completed load) is refused with 409.',
  })
  @IsIn(QUEUE_STATUS_TRANSITIONS)
  status: 'IN_PROGRESS' | 'COMPLETED';
}

/** Body for POST /loading/queue/:id/waybill (LO-05). */
export class RecordWaybillDto {
  @ApiProperty({ example: 'LAG-234-XY', description: 'Truck plate number' })
  @IsString()
  @IsNotEmpty()
  truckPlateNumber: string;

  @ApiProperty({ example: 'John Dare' })
  @IsString()
  @IsNotEmpty()
  driverName: string;

  @ApiProperty({ example: 320, description: 'Cartons actually loaded' })
  @IsInt()
  @Min(1)
  quantityCartons: number;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../proof.jpg',
    description:
      'Optional proof-of-loading image or PDF. Upload it first with ' +
      'POST /uploads (folder=waybill-documents) and pass the URL it returns.',
  })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}
