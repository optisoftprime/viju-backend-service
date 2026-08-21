import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

/**
 * The assigning officer embedded under each customer's `officerAssignments`.
 */
export class CustomerOfficerStaffDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;
}

export class CustomerOfficerAssignmentDto {
  @ApiProperty({ type: CustomerOfficerStaffDto })
  staff: CustomerOfficerStaffDto;
}

export class CustomerOpenTicketCountDto {
  @ApiProperty({ example: 2, description: 'Number of OPEN support tickets' })
  supportTickets: number;
}

/**
 * A single customer item as returned by GET /api/v1/admin/customers.
 * Matches the Prisma `select` in AdminService.getAllCustomers.
 */
export class CustomerListItemDto {
  @ApiProperty({
    example: 'customer-uuid-1',
    nullable: true,
    description:
      'Local record id. Null on an unprojected row, which has no local record ' +
      'yet — actions needing one must be disabled for that row.',
  })
  id: string | null;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiProperty({ example: 'ERP-001' })
  erpId: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({
    enum: ['ACTIVE', 'ON_HOLD'],
    example: 'ACTIVE',
    nullable: true,
    description:
      'Null only on an unprojected row (`isProjected: false`), which has no local record and no ERP source for this field.',
  })
  accountStatus: 'ACTIVE' | 'ON_HOLD' | null;

  @ApiProperty({
    example: 50000.5,
    nullable: true,
    description:
      'Outstanding balance. Null only on an unprojected row (`isProjected: false`), which has no local record and no ERP source for this field.',
  })
  outstandingBalance: number | null;

  @ApiProperty({
    example: 320,
    description:
      'B-1.1 — cartons paid for but not yet loaded (ordered minus completed ' +
      'loading requests, floored at zero). Null only on an unprojected row (`isProjected: false`), which has no local record and no ERP source for this field.',
    nullable: true,
  })
  stockBalanceCartons: number | null;

  @ApiProperty({
    example: '2026-08-19T04:30:05.124Z',
    format: 'date-time',
    nullable: true,
    description:
      'B-1.1 — when the ERP last reported this customer, read from the ERP ' +
      'feed. Null when the feed holds no row for this erpId, or when the ' +
      'environment has no ERP feed attached.',
  })
  lastSyncedAt: Date | null;

  @ApiProperty({
    example: true,
    description: 'Whether a primary officer is assigned. Matches ?hasOfficer=.',
  })
  hasOfficer: boolean;

  @ApiProperty({
    example: 'officer-uuid-1',
    nullable: true,
    description: 'Primary assigned officer id, or null when unassigned.',
  })
  assignedOfficerId: string | null;

  @ApiProperty({
    example: '2026-01-12T08:00:00.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'Null only on an unprojected row (`isProjected: false`), which has no local record and no ERP source for this field.',
  })
  createdAt: Date | null;

  @ApiProperty({ type: CustomerOpenTicketCountDto })
  _count: CustomerOpenTicketCountDto;

  @ApiProperty({ type: [CustomerOfficerAssignmentDto] })
  officerAssignments: CustomerOfficerAssignmentDto[];

  @ApiProperty({
    example: true,
    description:
      'False when the row is served straight from the ERP feed because the ' +
      'projector has not copied it into the portal yet. Always true in the ' +
      'default mode; only `includeUnprojected=true` can return false.',
  })
  isProjected: boolean;
}

/**
 * Full paginated payload for GET /api/v1/admin/customers.
 */
/**
 * `meta` for GET /admin/customers. Extends the standard block with the two
 * counts that make up `total` when `includeUnprojected=true`; both are absent
 * in the default mode.
 */
export class CustomerListMetaDto extends PaginationMetaDto {
  @ApiPropertyOptional({
    example: 4,
    description:
      'Customers that exist in the portal. Only present when includeUnprojected=true.',
  })
  projectedTotal?: number;

  @ApiPropertyOptional({
    example: 1847,
    description:
      'ERP customers not yet copied into the portal. Only present when ' +
      'includeUnprojected=true. Reaches 0 once projection has run.',
  })
  unprojectedTotal?: number;
}

export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerListItemDto] })
  data: CustomerListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: CustomerListMetaDto;
}
