import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiProperty({ example: 'ERP-001' })
  erpId: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ enum: ['ACTIVE', 'ON_HOLD'], example: 'ACTIVE' })
  accountStatus: 'ACTIVE' | 'ON_HOLD';

  @ApiProperty({ example: 50000.5, description: 'Outstanding balance' })
  outstandingBalance: number;

  @ApiProperty({
    example: 320,
    description:
      'B-1.1 — cartons paid for but not yet loaded (ordered minus completed ' +
      'loading requests, floored at zero).',
  })
  stockBalanceCartons: number;

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

  @ApiProperty({ example: '2026-01-12T08:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: CustomerOpenTicketCountDto })
  _count: CustomerOpenTicketCountDto;

  @ApiProperty({ type: [CustomerOfficerAssignmentDto] })
  officerAssignments: CustomerOfficerAssignmentDto[];
}

/**
 * Full paginated payload for GET /api/v1/admin/customers.
 */
export class PaginatedCustomersResponseDto {
  @ApiProperty({ type: [CustomerListItemDto] })
  data: CustomerListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
