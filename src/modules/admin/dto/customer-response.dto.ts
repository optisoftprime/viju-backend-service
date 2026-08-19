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
