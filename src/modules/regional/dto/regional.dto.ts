import { IsUUID, IsString, IsOptional, IsEnum, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoadingRequestStatus } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const STATUS_FILTER_VALUES = [
  ...Object.values(LoadingRequestStatus),
  'ALL',
] as const;

/**
 * Query params for GET /regional/loading-requests: status + region filters
 * plus pagination. Extends PaginationQueryDto so a single @Query() DTO covers
 * every param — required under the global `forbidNonWhitelisted` pipe.
 */
export class ListLoadingRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: STATUS_FILTER_VALUES,
    default: 'ALL',
    description: 'Filter by loading-request status, or ALL',
  })
  @IsOptional()
  @IsIn(STATUS_FILTER_VALUES as unknown as string[])
  status?: LoadingRequestStatus | 'ALL';

  @ApiPropertyOptional({
    enum: Region,
    description: 'ADMIN only — region to inspect (regional admins are scoped)',
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;
}

export class AssignLoadingOfficerDto {
  @ApiProperty({ description: 'Staff ID of the loading / warehouse officer' })
  @IsUUID()
  loadingOfficerId: string;
}

export class UpdateLoadingStatusDto {
  @ApiProperty({
    enum: ['LOADING_IN_PROGRESS', 'COMPLETED'],
    description:
      'Officer can advance from ASSIGNED → LOADING_IN_PROGRESS → COMPLETED. ' +
      'On COMPLETED, waybillDocumentUrl is required.',
  })
  @IsString()
  status: 'LOADING_IN_PROGRESS' | 'COMPLETED';

  @ApiPropertyOptional({
    description:
      'Required when status is COMPLETED — uploaded waybill / loading bill PDF URL',
  })
  @IsOptional()
  @IsString()
  waybillDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
