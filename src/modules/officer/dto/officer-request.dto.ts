import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SortQueryDto } from '../../../common/pagination/sort.dto';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

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
  // AO-C1 - "who is waiting on me, and for how long".
  'unreadMessages',
  'lastMessageAt',
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
    type: Boolean,
    description:
      'AO-C1 - when true, only distributors with at least one UNREAD message ' +
      'they sent (the "waiting on me" list). Mirrors `activeTickets`. ' +
      'Counts the same messages as the `unreadMessages` field on each row and ' +
      'as the Unread Messages tile on GET /officers/dashboard.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  unreadMessages?: boolean;

  @ApiPropertyOptional({
    enum: ASSIGNED_CUSTOMER_SORT_FIELDS,
    description:
      'Column to sort by, matching the dashboard table headers. Omit to keep ' +
      'the default ordering (name ascending). `accountNumber` sorts by erpId, ' +
      '`walletBalance` by outstanding balance; `lastPurchaseDate`, ' +
      '`openTickets`, `lastContactDate`, `unreadMessages` and ' +
      '`lastMessageAt` sort by the derived values shown in those columns. ' +
      'Sort by `lastMessageAt` ascending to put the distributor who has been ' +
      'waiting longest first; rows with no message at all sort last in both ' +
      'directions.',
  })
  @IsOptional()
  @IsIn(ASSIGNED_CUSTOMER_SORT_FIELDS)
  sortBy?: AssignedCustomerSortField;
}

/**
 * CH-3 — query params for GET /officers/chats.
 *
 * Deliberately just pagination and search. A conversation list has one
 * meaningful order (most recent first), so there is no `sortBy` to get wrong,
 * and no `hasMessages` filter because the resource is conversations by
 * definition.
 */
export class OfficerChatsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search by distributor name, account number (erpId) or phone — the ' +
      'same matching GET /officers/customers applies.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
