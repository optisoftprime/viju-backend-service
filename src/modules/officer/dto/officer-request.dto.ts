import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/**
 * Query params for GET /officers/customers: search + optional filters, plus
 * pagination. A single @Query() DTO so every param is whitelisted under the
 * global `forbidNonWhitelisted` pipe.
 */
export class AssignedCustomersFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search by distributor name, account number (erpId), or phone',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'When true, only distributors with an overdue balance (outstandingBalance < 0)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'When true, only distributors with active (open) support tickets',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeTickets?: boolean;
}
