import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';

const REGION_VALUES = ['LAGOS', 'SOUTH_WEST', 'SOUTH_EAST', 'NORTH'] as const;
type Region = (typeof REGION_VALUES)[number];

const STAFF_ROLE_VALUES = [
  'ADMIN',
  'OFFICER',
  'REGIONAL_ADMIN',
  'LOADING_OFFICER',
  'WAREHOUSE_OFFICER',
] as const;
type StaffRole = (typeof STAFF_ROLE_VALUES)[number];

// ─── Officer detail (GET /admin/officers/:id) ──────────────

export class OfficerDetailDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'James Okonkwo' })
  name: string;

  @ApiProperty({ example: 'james@gmail.com' })
  email: string;

  @ApiProperty({ example: '09009876543' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS', nullable: true })
  region: Region | null;

  @ApiProperty({ enum: STAFF_ROLE_VALUES, example: 'OFFICER' })
  role: StaffRole;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    example: '2026-06-18T09:13:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'Most recent successful login; null if never logged in',
  })
  lastLoginAt: Date | null;

  @ApiProperty({ example: 15, description: 'Distributors assigned to officer' })
  distributors: number;

  @ApiProperty({ example: 2, description: 'Open tickets across their customers' })
  openTickets: number;
}

// ─── Bulk reassign (PATCH /admin/officers/:id/reassign-customers) ──

export class BulkReassignResponseDto {
  @ApiProperty({ example: 15, description: 'Number of customers moved' })
  reassigned: number;

  @ApiProperty({ example: 'officer-uuid-1' })
  fromOfficerId: string;

  @ApiProperty({ example: 'officer-uuid-2' })
  toOfficerId: string;
}

// ─── Dashboard (GET /admin/dashboard) ──────────────────────

export class DashboardRegionNameDto {
  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  name: Region;

  @ApiProperty({ example: 42, description: 'Distributor count in this region' })
  dist: number;
}

export class DashboardRegionStatDto {
  @ApiProperty({ type: DashboardRegionNameDto })
  region: DashboardRegionNameDto;

  @ApiProperty({ example: 42 })
  distributors: number;

  @ApiProperty({ example: 1250000.75, description: 'Aggregate wallet balance' })
  walletBalance: number;

  @ApiProperty({ example: 5 })
  openTickets: number;

  @ApiProperty({ example: 3 })
  activeOfficers: number;
}

export class DashboardStatsDto {
  @ApiProperty({ example: 150 })
  totalCustomers: number;

  @ApiProperty({ example: 4500000.5 })
  totalOutstandingBalance: number;

  @ApiProperty({ example: 12 })
  activeOfficers: number;

  @ApiProperty({ example: 8 })
  openTickets: number;

  @ApiProperty({ example: 3, description: 'Unread customer messages' })
  unReadMessage: number;

  @ApiProperty({ type: [DashboardRegionStatDto] })
  byRegion: DashboardRegionStatDto[];
}

// ─── Test customer (POST /admin/customers) ─────────────────

export class TestCustomerDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-001' })
  erpId: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'acme@example.com', nullable: true })
  email: string | null;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;
}

// ─── Officers (GET/POST /admin/officers) ───────────────────

export class OfficerCustomerCountDto {
  @ApiProperty({ example: 24, description: 'Customers assigned to this officer' })
  customers: number;
}

export class OfficerListItemDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS', nullable: true })
  region: Region | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    example: '2026-06-18T09:13:00.000Z',
    format: 'date-time',
    description: 'When the account officer was created',
  })
  createdAt: Date;

  @ApiProperty({ type: OfficerCustomerCountDto })
  _count: OfficerCustomerCountDto;
}

export class PaginatedOfficersResponseDto {
  @ApiProperty({ type: [OfficerListItemDto] })
  data: OfficerListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/** Shape returned by POST /admin/officers (createOfficer). */
export class CreatedOfficerDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS', nullable: true })
  region: Region | null;
}

// ─── Product flyers (PRD F19) ──────────────────────────────

export class ProductFlyerDto {
  @ApiProperty({ example: 'flyer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'New Viju Chivita 1L' })
  name: string;

  @ApiProperty({ example: 'https://cdn.viju.example/flyers/chivita.jpg' })
  imageUrl: string;

  @ApiProperty({ example: 0, description: 'Display order (ascending)' })
  sortOrder: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 'admin-uuid-1', nullable: true })
  createdById: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}
