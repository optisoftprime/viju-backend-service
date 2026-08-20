import { IsUUID, IsString, IsOptional, IsEnum, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Region } from '../../../common/region/region.constants';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  ACCEPTED_LOADING_STATUS_VALUES,
  API_LOADING_STATUS_VALUES,
} from '../../loading/loading-status';

/**
 * Accepted status filters. The portal vocabulary (PENDING | ASSIGNED |
 * IN_PROGRESS | COMPLETED | CANCELLED) matches the FE's filter tabs; the
 * database spelling is still accepted so existing clients keep working.
 */
const STATUS_FILTER_VALUES = [
  ...ACCEPTED_LOADING_STATUS_VALUES,
  'ALL',
] as const;

/**
 * Query params for GET /regional/loading-requests: status + region filters
 * plus pagination. Extends PaginationQueryDto so a single @Query() DTO covers
 * every param — required under the global `forbidNonWhitelisted` pipe.
 */
export class ListLoadingRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [...API_LOADING_STATUS_VALUES, 'ALL'],
    default: 'ALL',
    description:
      'Filter by loading-request status, or ALL. Matches the FE filter tabs ' +
      '(All / Pending / Assigned / Loading In Progress / Completed). The ' +
      'database spelling (PENDING_ASSIGNMENT, LOADING_IN_PROGRESS) is also ' +
      'accepted for backwards compatibility.',
  })
  @IsOptional()
  @IsIn(STATUS_FILTER_VALUES)
  status?: string;

  @ApiPropertyOptional({
    description:
      'Search by waybill reference, order reference, distributor name, ' +
      'truck plate or driver name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: Region,
    description:
      'ADMIN only — region to inspect. Ignored for REGIONAL_ADMIN, who is ' +
      "always scoped to their own token's region (RA-03).",
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}

export class AssignLoadingOfficerDto {
  @ApiProperty({
    description: 'Staff ID of the loading / warehouse officer',
    example: 'b1f2e3d4-5678-90ab-cdef-1234567890ab',
  })
  @IsUUID()
  loadingOfficerId: string;
}

export class UpdateLoadingStatusDto {
  @ApiProperty({
    enum: ['LOADING_IN_PROGRESS', 'COMPLETED'],
    example: 'LOADING_IN_PROGRESS',
    description:
      'Officer can advance from ASSIGNED → LOADING_IN_PROGRESS → COMPLETED. ' +
      'On COMPLETED, waybillDocumentUrl is required.',
  })
  @IsString()
  status: 'LOADING_IN_PROGRESS' | 'COMPLETED';

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/viju/waybills/WB-19045.pdf',
    description:
      'Required when status is COMPLETED — uploaded waybill / loading bill PDF URL',
  })
  @IsOptional()
  @IsString()
  waybillDocumentUrl?: string;

  @ApiPropertyOptional({ example: 'Loaded without issue' })
  @IsOptional()
  @IsString()
  notes?: string;
}
