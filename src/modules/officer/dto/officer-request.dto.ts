import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SortQueryDto } from '../../../common/pagination/sort.dto';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/** Columns GET /officers/customers can be sorted by (US-09.3). */
export const ASSIGNED_CUSTOMER_SORT_FIELDS = [
  'name',
  'accountNumber',
  'walletBalance',
  'lastPurchaseDate',
  'openTickets',
  'lastContactDate',
] as const;
export type AssignedCustomerSortField =
  (typeof ASSIGNED_CUSTOMER_SORT_FIELDS)[number];

/**
 * Query params for GET /officers/customers: search + optional filters, plus
 * pagination. A single @Query() DTO so every param is whitelisted under the
 * global `forbidNonWhitelisted` pipe.
 */
export class AssignedCustomersFilterDto extends SortQueryDto {
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

  @ApiPropertyOptional({
    enum: ASSIGNED_CUSTOMER_SORT_FIELDS,
    description:
      'Column to sort by, matching the dashboard table headers. Omit to keep ' +
      'the default ordering (name ascending). `accountNumber` sorts by erpId, ' +
      '`walletBalance` by outstanding balance; `lastPurchaseDate`, ' +
      '`openTickets` and `lastContactDate` sort by the derived values shown ' +
      'in those columns.',
  })
  @IsOptional()
  @IsIn(ASSIGNED_CUSTOMER_SORT_FIELDS)
  sortBy?: AssignedCustomerSortField;
}
