import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { CustomerOpenTicketCountDto } from './customer-response.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';
import { MANAGED_STAFF_ROLE_VALUES } from '../../../common/roles/managed-roles';

const STAFF_ROLE_VALUES = [
  'ADMIN',
  'OFFICER',
  'REGIONAL_ADMIN',
  'LOADING_OFFICER',
  'WAREHOUSE_OFFICER',
] as const;
type StaffRole = (typeof STAFF_ROLE_VALUES)[number];

/**
 * The admin behind a lifecycle action (PRD 12). Null when the account
 * predates admin-managed provisioning, or when the admin row has since been
 * removed — the FK is ON DELETE SET NULL so the audit row still survives.
 */
export class StaffAuditActorDto {
  @ApiProperty({ example: 'admin-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Grace Adeyemi' })
  name: string;

  @ApiProperty({ example: 'grace@viju.com' })
  email: string;
}

// ─── Officer detail (GET /admin/officers/:id) ──────────────

export class OfficerPortfolioCustomerDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Ade Foods Ltd' })
  name: string;

  @ApiProperty({ example: 'VJ-00987' })
  erpId: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;
}

export class OfficerDetailCountDto {
  @ApiProperty({ example: 24, description: 'Customers assigned' })
  customers: number;

  @ApiProperty({ example: 3, description: 'OPEN tickets across them' })
  supportTickets: number;

  @ApiProperty({
    example: 11,
    description: 'Customers this officer has a chat thread with',
  })
  chatThreads: number;
}

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

  @ApiProperty({ example: '2026-01-12T08:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    example: true,
    description:
      'True when this service owns the account lifecycle (ADMIN, ' +
      'REGIONAL_ADMIN, OFFICER, LOADING_OFFICER). False for ERP-mirrored ' +
      'roles, whose status cannot be changed here.',
  })
  isManaged: boolean;

  @ApiProperty({
    type: StaffAuditActorDto,
    nullable: true,
    description: 'PRD 12 — the admin who created this account.',
  })
  createdBy: StaffAuditActorDto | null;

  @ApiProperty({
    example: '2026-08-20T14:02:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'When the account was last deactivated; null if never.',
  })
  deactivatedAt: Date | null;

  @ApiProperty({ type: StaffAuditActorDto, nullable: true })
  deactivatedBy: StaffAuditActorDto | null;

  @ApiProperty({
    example: '2026-08-21T09:10:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'When the account was last reactivated; null if never.',
  })
  reactivatedAt: Date | null;

  @ApiProperty({ type: StaffAuditActorDto, nullable: true })
  reactivatedBy: StaffAuditActorDto | null;

  @ApiProperty({ type: OfficerDetailCountDto })
  _count: OfficerDetailCountDto;

  @ApiProperty({
    type: [OfficerPortfolioCustomerDto],
    description: 'B-4.1 — the officer’s portfolio, name-ascending.',
  })
  customers: OfficerPortfolioCustomerDto[];

  @ApiProperty({
    example: 15,
    deprecated: true,
    description: 'Deprecated alias of _count.customers.',
  })
  distributors: number;

  @ApiProperty({
    example: 2,
    deprecated: true,
    description: 'Deprecated alias of _count.supportTickets.',
  })
  openTickets: number;
}

// ─── Single reassign (PATCH /admin/customers/:id/reassign) ──

/** The officer on one CustomerOfficer row. */
export class ReassignedOfficerStaffDto {
  @ApiProperty({ example: '7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44' })
  id: string;

  @ApiProperty({ example: 'Ifeanyi Okon' })
  name: string;

  @ApiProperty({ example: 'i.okon@viju.com' })
  email: string;
}

/** One officer assignment as it stands after the call. */
export class ReassignedOfficerAssignmentDto {
  @ApiProperty({ example: 'as1f2e3d-4c5b-6a79-8081-92a3b4c5d6e7' })
  id: string;

  @ApiProperty({ example: true })
  isPrimary: boolean;

  @ApiProperty({ example: '2026-08-22T09:10:00.000Z', format: 'date-time' })
  assignedAt: Date;

  @ApiProperty({ type: ReassignedOfficerStaffDto })
  staff: ReassignedOfficerStaffDto;
}

/**
 * AD-R1 - body of PATCH /admin/customers/:id/reassign.
 *
 * Carries the resulting assignments so the OFFICERS cell can be refreshed
 * straight from the response, primary first.
 */
export class ReassignCustomerResponseDto {
  @ApiProperty({ example: 'Customer assigned successfully' })
  message: string;

  @ApiProperty({ example: 'bd5dbe51-b00e-4d05-a321-76108e0f3918' })
  customerId: string;

  @ApiProperty({
    type: [ReassignedOfficerAssignmentDto],
    description: 'Every officer on the customer after the call, primary first.',
  })
  officerAssignments: ReassignedOfficerAssignmentDto[];
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

/** B-1.2 — provenance of the headline customer count. */
export class ErpReconciliationDto {
  @ApiProperty({
    enum: ['ERP', 'LOCAL'],
    example: 'ERP',
    description:
      "'ERP' when the counts came from the ERP feed, 'LOCAL' when no feed is " +
      'attached and the locally projected count was used instead.',
  })
  source: 'ERP' | 'LOCAL';

  @ApiProperty({
    example: 3747,
    description: 'Every row in the ERP customer feed, all tenants included.',
  })
  erpTotal: number;

  @ApiProperty({
    example: 1851,
    description:
      'ERP rows whose BP_CLUSTER_CODE maps to a Viju region (1-5) — the ' +
      'distributor count the portal reports.',
  })
  vijuTotal: number;

  @ApiProperty({
    example: 4,
    description: 'Customers actually projected into this database so far.',
  })
  syncedTotal: number;

  @ApiProperty({
    example: 1847,
    description:
      'vijuTotal minus syncedTotal — customers the ERP has that the projector ' +
      'has not copied across yet. Non-zero means the projection job is behind.',
  })
  awaitingProjection: number;

  @ApiProperty({
    example: 1896,
    description: 'ERP rows whose region could not be mapped (B-2.3).',
  })
  unmappedRegionCount: number;

  @ApiProperty({
    example: '2026-08-19T04:30:05.124Z',
    format: 'date-time',
    nullable: true,
  })
  lastSyncAt: Date | null;
}

export class DashboardStatsDto {
  @ApiProperty({
    example: 1851,
    description:
      'B-1.2 — distributors as the ERP reports them, not the number projected ' +
      'locally. Falls back to the local count when no ERP feed is attached. ' +
      'Never null: 0 when nothing is known.',
  })
  totalCustomers: number;

  @ApiProperty({
    example: 1820,
    description: 'Locally known customers whose account status is ACTIVE.',
  })
  totalActiveCustomers: number;

  @ApiProperty({
    example: 12,
    description: 'Locally known customers with no assigned officer.',
  })
  customersWithoutOfficer: number;

  @ApiProperty({
    example: '2026-08-19T04:30:05.124Z',
    format: 'date-time',
    nullable: true,
    description:
      'Last successful ERP sync. Null when no feed is attached — render the ' +
      'tile with a staleness warning rather than hiding it.',
  })
  lastErpSyncAt: Date | null;

  @ApiProperty({
    example: 1896,
    description:
      'B-2.3 — ERP customer rows whose region does not map to a Viju region. ' +
      'Surfaced so the mismatch is visible; these are not counted as ' +
      'distributors.',
  })
  unmappedRegionCount: number;

  @ApiProperty({ type: ErpReconciliationDto })
  erpReconciliation: ErpReconciliationDto;

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

// ─── Customer detail (GET /admin/customers/:id) — B-3 ──────

export class CustomerDetailOfficerDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Ifeanyi Okon' })
  name: string;

  @ApiProperty({ example: 'i.okon@viju.com' })
  email: string;
}

export class CustomerDetailAssignmentDto {
  @ApiProperty({ example: 'assignment-uuid-1' })
  id: string;

  @ApiProperty({ example: true })
  isPrimary: boolean;

  @ApiProperty({ example: '2026-01-12T08:00:00.000Z', format: 'date-time' })
  assignedAt: Date;

  @ApiProperty({ type: CustomerDetailOfficerDto })
  staff: CustomerDetailOfficerDto;
}

/**
 * B-3 — full customer record at ERP parity. Every optional field is present
 * as an explicit null rather than omitted.
 */
export class AdminCustomerDetailDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-00987' })
  erpId: string;

  @ApiProperty({ example: 'Ade Foods Ltd' })
  name: string;

  @ApiProperty({ example: '08087654321' })
  phone: string;

  @ApiProperty({ example: 'ops@adefoods.com', nullable: true })
  email: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Always null today — the ERP customer master carries no address field. ' +
      'Populating it needs an ERP change; see the handoff notes.',
  })
  address: string | null;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ example: true, description: 'accountStatus === ACTIVE' })
  isActive: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'ON_HOLD'], example: 'ACTIVE' })
  accountStatus: 'ACTIVE' | 'ON_HOLD';

  @ApiProperty({ example: 1240000 })
  outstandingBalance: number;

  @ApiProperty({ example: 320, description: 'Cartons awaiting loading' })
  stockBalanceCartons: number;

  @ApiProperty({
    example: 2000000,
    nullable: true,
    description:
      'Latest effective ERP credit limit (CREDIT_AMT). Null when the ERP ' +
      'holds none for this customer.',
  })
  creditLimit: number | null;

  @ApiProperty({ type: [CustomerDetailAssignmentDto] })
  officerAssignments: CustomerDetailAssignmentDto[];

  @ApiProperty({ type: CustomerOpenTicketCountDto })
  _count: CustomerOpenTicketCountDto;

  @ApiProperty({
    example: '2026-08-19T04:30:05.124Z',
    format: 'date-time',
    nullable: true,
  })
  lastErpSyncAt: Date | null;

  @ApiProperty({ example: '2026-01-12T08:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-08-19T09:15:00.000Z', format: 'date-time' })
  updatedAt: Date;
}

// ─── ERP reconciliation (GET /admin/erp/*) — B-2.3 ─────────

export class UnmappedErpCustomerDto {
  @ApiProperty({ example: 'T20642', description: 'ERP CUSTOMER_CODE' })
  erpId: string;

  @ApiProperty({ example: '潍坊绿霸化工有限公司', nullable: true })
  name: string | null;

  @ApiProperty({ example: '0913580925', nullable: true })
  phone: string | null;

  @ApiProperty({
    example: 'GZ020',
    nullable: true,
    description: 'The raw BP_CLUSTER_CODE exactly as the ERP sent it.',
  })
  bpClusterCode: string | null;

  @ApiProperty({ example: '广州拓燊客户编码', nullable: true })
  bpClusterName: string | null;

  @ApiProperty({
    example: '2026-08-19T04:30:05.124Z',
    format: 'date-time',
    nullable: true,
  })
  lastSeenAt: Date | null;
}

export class PaginatedUnmappedErpCustomersResponseDto {
  @ApiProperty({ type: [UnmappedErpCustomerDto] })
  data: UnmappedErpCustomerDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class ErpSyncJobDto {
  @ApiProperty({ example: 'ingest:customer' })
  job: string;

  @ApiProperty({ example: 'SUCCESS' })
  status: string;

  @ApiProperty({
    example: '2026-08-19T04:30:40.113Z',
    format: 'date-time',
    nullable: true,
  })
  lastFinishedAt: Date | null;

  @ApiProperty({ example: 3747, nullable: true })
  rowsFetched: number | null;

  @ApiProperty({ example: 0, nullable: true })
  rowsProjected: number | null;
}

export class ErpCustomerCountsDto {
  @ApiProperty({ example: 3747 })
  erpTotal: number;

  @ApiProperty({ example: 1851 })
  vijuTotal: number;

  @ApiProperty({ example: 1896 })
  unmappedRegionCount: number;

  @ApiProperty({
    example: {
      LAGOS: 734,
      EASTERN: 82,
      SOUTH_SOUTH: 133,
      WESTERN: 439,
      NORTH: 463,
    },
    description: 'Mappable ERP customers per region.',
  })
  byRegion: Record<string, number>;
}

export class ErpSyncStatusDto {
  @ApiProperty({
    example: true,
    description: 'False when this database has no ERP feed attached.',
  })
  available: boolean;

  @ApiProperty({
    example: '2026-08-20T17:21:05.529Z',
    format: 'date-time',
    nullable: true,
  })
  lastSyncAt: Date | null;

  @ApiProperty({ type: ErpCustomerCountsDto })
  customers: ErpCustomerCountsDto;

  @ApiProperty({ type: [ErpSyncJobDto] })
  jobs: ErpSyncJobDto[];
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
  @ApiProperty({
    example: 24,
    description: 'Customers assigned to this officer',
  })
  customers: number;

  @ApiProperty({
    example: 3,
    description:
      'US-15.1 — OPEN support tickets across this officer’s customers. ' +
      'Derived per row, so it always matches the number the officer list shows.',
  })
  supportTickets: number;
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

  @ApiProperty({
    example: '2026-08-19T07:41:00.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'US-15.1 — most recent successful login. Null until the officer has ' +
      'logged in at least once; do not substitute createdAt for it.',
  })
  lastLoginAt: Date | null;

  @ApiProperty({
    enum: STAFF_ROLE_VALUES,
    example: 'OFFICER',
    description:
      'The listed role. Present so `managed=true` pages can mix all four ' +
      'internally managed roles.',
  })
  role: StaffRole;

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
    description: 'When the account was last deactivated; null if never.',
  })
  deactivatedAt: Date | null;

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
    description: 'When the account was last reactivated; null if never.',
  })
  reactivatedAt: Date | null;

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

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    enum: MANAGED_STAFF_ROLE_VALUES,
    example: 'OFFICER',
    description:
      'The provisioned role. `ACCOUNT_OFFICER` in the request is stored and ' +
      'returned as `OFFICER`.',
  })
  role: StaffRole;

  @ApiProperty({ example: '2026-08-19T10:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    example: 'admin-uuid-1',
    nullable: true,
    description: 'PRD 12 — id of the admin who created this account.',
  })
  createdById: string | null;

  @ApiProperty({
    example: true,
    description:
      'US-15.3 — whether the credentials email was delivered. The user is ' +
      'created either way; false means the admin should pass the password on ' +
      'by another route.',
  })
  emailSent: boolean;
}

/**
 * Shape returned by PATCH /admin/officers/:id (activate / deactivate).
 */
export class OfficerStatusDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Ifeanyi Okon' })
  name: string;

  @ApiProperty({ example: 'i.okon@viju.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS', nullable: true })
  region: Region | null;

  @ApiProperty({ enum: MANAGED_STAFF_ROLE_VALUES, example: 'OFFICER' })
  role: StaffRole;

  @ApiProperty({ example: false, description: 'False once deactivated' })
  isActive: boolean;

  @ApiProperty({
    example: true,
    description:
      'False when the user was ALREADY in the requested state, so nothing ' +
      'was written and the audit stamps were left alone. Lets the FE tell a ' +
      'real change apart from a repeated or concurrent request.',
  })
  changed: boolean;

  @ApiProperty({
    example: '2026-08-21T10:30:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  deactivatedAt: Date | null;

  @ApiProperty({
    example: 'admin-uuid-1',
    nullable: true,
    description: 'PRD 12 — id of the admin who deactivated this account.',
  })
  deactivatedById: string | null;

  @ApiProperty({
    example: null,
    format: 'date-time',
    nullable: true,
  })
  reactivatedAt: Date | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'PRD 12 — id of the admin who reactivated this account.',
  })
  reactivatedById: string | null;

  @ApiProperty({ example: '2026-08-19T10:30:00.000Z', format: 'date-time' })
  updatedAt: Date;
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
