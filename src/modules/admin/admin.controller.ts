import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiProduces,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ReassignOfficerDto,
  CreateOfficerDto,
  CreateTestCustomerDto,
  CreateProductFlyerDto,
  UpdateProductFlyerDto,
  ReorderProductFlyersDto,
  CustomerFilterDto,
  OfficerFilterDto,
  UpdateOfficerStatusDto,
  BulkOfficerRegionDto,
  BulkReassignCustomersDto,
} from './dto/admin.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Region } from '../../common/region/region.constants';
import { StaffRole } from '@prisma/client';
import { PaginatedCustomersResponseDto } from './dto/customer-response.dto';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import {
  DashboardStatsDto,
  TestCustomerDto,
  PaginatedOfficersResponseDto,
  CreatedOfficerDto,
  ProductFlyerDto,
  OfficerDetailDto,
  BulkReassignResponseDto,
  OfficerStatusDto,
  AdminCustomerDetailDto,
  ErpSyncStatusDto,
  PaginatedUnmappedErpCustomersResponseDto,
  ReassignCustomerResponseDto,
  BulkOperationResultDto,
} from './dto/admin-response.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

/**
 * CC-01: every route here is ADMIN-only at the server, regardless of what the
 * web app chooses to render. A handler-level @Roles(...) overrides the
 * class-level one — used by GET /admin/officers, which regional admins also
 * need (RA-05) but only ever for their own region.
 */
@ApiTags('Admin Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is not an ADMIN: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get aggregate organization dashboard stats',
    description:
      'B-1.2 — `totalCustomers` is the ERP-reconciled distributor count, not ' +
      'the number of rows projected locally, so the tile stops ' +
      'under-reporting. `erpReconciliation` shows the provenance ' +
      '(erpTotal / vijuTotal / syncedTotal / awaitingProjection), and ' +
      '`unmappedRegionCount` (B-2.3) exposes ERP rows whose region does not ' +
      'map. Counts are 0 rather than null when unknown; `lastErpSyncAt` shows ' +
      'staleness.',
  })
  @ApiOkResponse({ type: DashboardStatsDto })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  @Get('customers')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'List customers with optional region filter + name/erpId search',
    description:
      'Sortable (US-09.3): pass `sortBy` with one of name | erpId | region | ' +
      'outstandingBalance | supportTickets | createdAt, plus `sortOrder` ' +
      '(asc | desc, default desc). With no `sortBy` the ordering is unchanged ' +
      '(erpId ascending). An unrecognised `sortBy` is rejected with 400.\n\n' +
      'B-1.1: `hasOfficer=true|false` filters on officer assignment server ' +
      'side, so the assignment screen no longer has to page through everything ' +
      'and filter locally. Each row now carries `stockBalanceCartons`, ' +
      '`lastSyncedAt` (ERP freshness), `hasOfficer` and `createdAt`.\n\n' +
      '`pageSize` accepts any positive integer and is clamped to 200 rather ' +
      'than rejected — read `meta.pageSize` for the value actually applied.\n\n' +
      '`meta.total` counts the rows this filter matches, so pagination stays ' +
      'correct. For the ERP-reconciled distributor count use ' +
      'GET /admin/dashboard (`totalCustomers` / `erpReconciliation`).\n\n' +
      '`includeUnprojected=true` closes the gap between the two: the result ' +
      'set becomes the union of projected customers and ERP customers not ' +
      'yet copied into the portal, `meta.total` is the size of that union, ' +
      'and `meta` gains `projectedTotal` / `unprojectedTotal`. Rows carry ' +
      '`isProjected`; an unprojected row has `id: null` and null for every ' +
      'field the ERP customer master does not carry, so actions that need a ' +
      'local record must be disabled for it. Projected rows come first in ' +
      'the requested sort order, then unprojected rows by erpId. Default is ' +
      'false, so existing callers see no change.\n\n' +
      'RA-C1: REGIONAL_ADMIN is authorised on this route and is ALWAYS ' +
      'scoped to their own region, derived from the token. They must NOT ' +
      'send `region` - doing so is refused with ' +
      '`403 { "message": "Region is derived from your account", "code": ' +
      '"REGION_NOT_ALLOWED" }` (B-1.1), because region scoping is not ' +
      'something a client may choose. `outstandingBalance` is returned as a ' +
      'full-precision number, never a pre-formatted 2-dp string.\n\n' +
      'AD-S1: `search` matches `name` and `erpId` on projected rows and the ' +
      'equivalent ERP-feed fields (CUSTOMER_NAME / CUSTOMER_CODE) on ' +
      'unprojected ones, on BOTH halves of the union, and `meta.total` is the ' +
      'size of the FILTERED union so paging stays arithmetically correct.',
  })
  @ApiOkResponse({
    description: 'Paginated list of customers',
    type: PaginatedCustomersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  @ApiForbiddenResponse({
    description:
      'Caller is neither an ADMIN nor a REGIONAL_ADMIN, or a REGIONAL_ADMIN ' +
      'sent `region`: ' +
      '`{ "message": "Region is derived from your account", "code": "REGION_NOT_ALLOWED" }`',
  })
  async getAllCustomers(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() query: CustomerFilterDto,
  ) {
    return this.adminService.getAllCustomers(
      { ...query, region: this.customerListRegion(user, query.region) },
      query,
    );
  }

  /**
   * RA-C1 / B-1.1 - which region the customer list is allowed to read.
   *
   * An ADMIN sees every region and may narrow with `region`. A
   * REGIONAL_ADMIN is pinned to the region on their own record and may not
   * pass the parameter at all: silently ignoring it would let a wrong value
   * look like it worked, so it is refused outright and the client drops it.
   *
   * A REGIONAL_ADMIN whose record carries NO region cannot be scoped, and
   * returning `undefined` would hand them every region at once. That is a
   * misconfigured account, so it is refused rather than widened.
   */
  private customerListRegion(
    user: { role: string; region?: Region | null },
    requested: Region | undefined,
  ): Region | undefined {
    if (user.role !== 'REGIONAL_ADMIN') return requested;
    if (requested !== undefined) {
      throw new ForbiddenException({
        message: 'Region is derived from your account',
        code: 'REGION_NOT_ALLOWED',
        statusCode: HttpStatus.FORBIDDEN,
      });
    }
    if (!user.region) {
      throw new ForbiddenException({
        message: 'No region is set on your account. Contact an administrator.',
        code: 'REGION_NOT_SET',
        statusCode: HttpStatus.FORBIDDEN,
      });
    }
    return user.region;
  }

  @Get('customers/export.csv')
  @ApiOperation({
    summary: 'Export filtered customer list as CSV',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'CSV file of filtered customers',
    schema: { type: 'string', format: 'binary' },
  })
  async exportCustomers(
    @Query('region')
    region: Region | undefined,
    @Query('search') search: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.adminService.exportCustomersCsv({ region, search });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-customers.csv"',
    );
    res.send(csv);
  }

  @Get('customers/:id')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Customer detail at ERP parity (B-3)',
    description:
      'Everything the portal holds for one customer plus what the ERP feed ' +
      'reports for the same erpId: `creditLimit` (latest effective ERP credit ' +
      'limit), `stockBalanceCartons`, and `lastErpSyncAt`.\n\n' +
      'Every optional field is present as an explicit null rather than ' +
      'omitted. `address` is always null today — the ERP customer master has ' +
      'no address field.\n\n' +
      'A REGIONAL_ADMIN may only open a customer in their own region (403 ' +
      'otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Internal customer UUID' })
  @ApiOkResponse({ type: AdminCustomerDetailDto })
  @ApiNotFoundResponse({ description: 'Customer not found' })
  async getCustomerDetail(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Param('id') id: string,
  ) {
    return this.adminService.getCustomerDetail(id, user);
  }

  // ─── ERP reconciliation (B-1.2 / B-2.3) ─────────────────────
  @Get('erp/sync-status')
  @ApiOperation({
    summary: 'ERP ingest / projection freshness (B-1.2)',
    description:
      'Per-job status of the ERP pipeline plus the customer counts the feed ' +
      'reports. Use it to show data freshness and to see when the projector ' +
      'is behind. `available: false` means this environment has no ERP feed ' +
      'attached.',
  })
  @ApiOkResponse({ type: ErpSyncStatusDto })
  async getErpSyncStatus() {
    return this.adminService.getErpSyncStatus();
  }

  @Get('erp/unmapped-customers')
  @ApiOperation({
    summary: 'ERP customers whose region could not be mapped (B-2.3)',
    description:
      'The quarantine list behind `unmappedRegionCount` on the dashboard: ERP ' +
      'rows whose BP_CLUSTER_CODE is not one of the Viju regions (1-5) — ' +
      'other-tenant codes and blanks. These are never counted as ' +
      'distributors. Read-only; `bpClusterCode` is the raw ERP value so the ' +
      'ERP team can be given specifics.',
  })
  @ApiOkResponse({ type: PaginatedUnmappedErpCustomersResponseDto })
  async listUnmappedErpCustomers(@Query() pagination: PaginationQueryDto) {
    return this.adminService.listUnmappedErpCustomers(pagination);
  }

  // Declared BEFORE @Patch('customers/:id/reassign') so the literal
  // 'bulk-reassign' segment is not swallowed as a customer id.
  @Patch('customers/bulk-reassign')
  @ApiOperation({
    summary: 'Assign a selection of customers to one account officer',
    description:
      'C-2 — the "Assign Account Officer" action over a checkbox selection on ' +
      '/admin/distributors. Body ' +
      '`{ "customerIds": string[], "newOfficerId": string }`.\n\n' +
      'PER-CUSTOMER RESULTS, never all-or-nothing: assigning 79 of 80 leaves ' +
      'the 79 assigned and names the one that failed in `failed`.\n\n' +
      'Each move applies the same rules as PATCH /admin/customers/{id}/' +
      'reassign — including the region rule (the officer must be ACTIVE and ' +
      'in the CUSTOMER’s region), the CustomerOfficer bookkeeping so chat and ' +
      'tickets follow, and the ASSIGNMENT notification to the incoming ' +
      'officer.\n\n' +
      '`ALREADY_ASSIGNED` COUNTS AS A SUCCESS here: the customer ends up ' +
      'holding exactly the officer that was asked for, which is the point of ' +
      'the call. (The single route still refuses it, so an operator acting on ' +
      'one customer is told why nothing changed.)\n\n' +
      'Duplicate ids are collapsed. Maximum 500 per call.',
  })
  @ApiOkResponse({ type: BulkOperationResultDto })
  @ApiBadRequestResponse({
    description:
      'Empty customerIds, more than 500 ids, or a missing officer id',
  })
  async bulkReassignCustomers(@Body() dto: BulkReassignCustomersDto) {
    return this.adminService.bulkReassignCustomers(
      dto.customerIds,
      dto.newOfficerId,
    );
  }

  @Patch('customers/:id/reassign')
  @ApiOperation({
    summary: 'Assign or reassign a customer to an account officer (AD-R1)',
    description:
      'Sets the assignment outright, so it works for a customer who has NO ' +
      'officer yet (empty `officerAssignments[]`) exactly as it does for one ' +
      'being moved between officers.\n\n' +
      'Moves both the primary pointer and the CustomerOfficer join row, so ' +
      'the chat thread and every ticket for this customer follow the ' +
      'assignment (US-13.5) — the new officer sees the complete history and ' +
      'the previous officer loses access.\n\n' +
      'Side effect (US-13.4, AD-R1): the incoming officer gets an ASSIGNMENT ' +
      'notification in the bell AND a web push, on a first assignment as ' +
      'well as on a reassignment. Push is best-effort and never fails the ' +
      'call; the in-app row is always written.\n\n' +
      'The response carries the resulting `officerAssignments`, so the ' +
      'OFFICERS cell can be refreshed without a refetch.',
  })
  @ApiOkResponse({ type: ReassignCustomerResponseDto })
  @ApiBadRequestResponse({
    description:
      'New officer is unknown, inactive, or in a different region: ' +
      '`{ "message": "Officer not found or inactive", "code": "OFFICER_NOT_FOUND" }`',
  })
  @ApiNotFoundResponse({
    description:
      '`{ "message": "Customer not found", "code": "CUSTOMER_NOT_FOUND" }`',
  })
  @ApiConflictResponse({
    description:
      'That officer already holds this customer as primary: ' +
      '`{ "message": "<name> is already assigned to this customer", "code": "ALREADY_ASSIGNED" }`',
  })
  async reassignOfficer(
    @Param('id') id: string,
    @Body() dto: ReassignOfficerDto,
  ) {
    return this.adminService.reassignOfficer(id, dto);
  }

  @Post('customers')
  @ApiOperation({
    summary: 'Create a test customer (mocks ERP customer sync)',
    description:
      'Stand-in for the ERP customer sync until that integration lands. ' +
      'Lets FE/QA seed any phone number for OTP flow testing without waiting on ERP. ' +
      'Replace or remove once /erp/sync/customers is wired up.',
  })
  @ApiOkResponse({ type: TestCustomerDto })
  async createTestCustomer(@Body() dto: CreateTestCustomerDto) {
    return this.adminService.createTestCustomer(dto);
  }

  @Get('officers')
  @Roles('ADMIN', 'REGIONAL_ADMIN', 'OFFICER')
  @ApiOperation({
    summary: 'List staff officers (region filter + search + sort)',
    description:
      'ADMIN sees every region and may narrow with `region`. REGIONAL_ADMIN ' +
      "is forced to their own token's region and any client-supplied " +
      '`region` is ACCEPTED AND IGNORED (RA-05, RA-O1) — the request still ' +
      'answers 200 with that admin\u2019s own region, and never a ' +
      '`REGION_NOT_ALLOWED` 403. This deliberately differs from ' +
      'GET /admin/customers, which refuses the parameter outright; the ' +
      'officer picker has always tolerated it and nothing is leaked either ' +
      'way, since the scope is read from the token. A user cannot widen ' +
      'their scope by editing the query string.\n\n' +
      'A-2: an OFFICER (account officer) may also call this route, for the ' +
      'assign-loading-officer picker on their own loading-request screen. ' +
      'They are pinned to `role=LOADING_OFFICER` and to their own region ' +
      'whatever the query string says, so it cannot be used to enumerate ' +
      'their peers.\n\n' +
      'Pass `role=LOADING_OFFICER` to list loading officers for the ' +
      'assign-loading-officer picker (RA-06); it defaults to OFFICER. ' +
      '`role=ADMIN` / `role=REGIONAL_ADMIN` list those internally managed ' +
      'users, and `managed=true` returns all four managed roles in one page. ' +
      'Each row carries `role`, `isActive`, `deactivatedAt` and ' +
      '`reactivatedAt`. Add `isActive=true|false` to filter on status ' +
      '(omit for both, which is the unchanged default).\n\n' +
      'Sortable (US-09.3): `sortBy` accepts name | email | region | ' +
      'customers | createdAt | lastLoginAt | supportTickets with `sortOrder` ' +
      '(asc | desc, default desc). Default ordering (no `sortBy`) is name ' +
      'ascending. An unknown `sortBy` is rejected with 400.',
  })
  @ApiOkResponse({ type: PaginatedOfficersResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  async getOfficers(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Query() query: OfficerFilterDto,
  ) {
    const isAdmin = user.role === 'ADMIN';

    // RA-03: region-scoped roles filter by the TOKEN's region, never by the
    // query param, which the caller controls.
    const region = isAdmin ? query.region : (user.region ?? undefined);

    // Only an ADMIN manages users, so only an ADMIN may enumerate the
    // administrative roles. A REGIONAL_ADMIN reaches this route for the
    // operational pickers (RA-05 officers, RA-06 loading officers) and is
    // held to those two roles no matter what the query string says.
    //
    // A-2: an ACCOUNT OFFICER now reaches it too, for one reason only —
    // populating the assign-loading-officer picker. They are pinned to
    // LOADING_OFFICER whatever the query string says, so this cannot become a
    // way for one officer to enumerate their peers, and `region` above already
    // holds them to their own region.
    const role =
      user.role === StaffRole.OFFICER
        ? StaffRole.LOADING_OFFICER
        : isAdmin || query.role === StaffRole.LOADING_OFFICER
          ? query.role
          : StaffRole.OFFICER;

    return this.adminService.getOfficers(
      { ...query, region, role, managed: isAdmin ? query.managed : false },
      query,
    );
  }

  @Post('officers')
  @ApiOperation({
    summary: 'Create an internally managed staff user',
    description:
      'ADMIN-only. Provisions one of the four roles this service owns — ' +
      '`OFFICER` (account officer, the default and the pre-existing ' +
      'behaviour), `LOADING_OFFICER`, `REGIONAL_ADMIN` or `ADMIN`. ' +
      '`ACCOUNT_OFFICER` is accepted as an alias for `OFFICER`. Any other ' +
      'value — including `WAREHOUSE_OFFICER`, which the ERP still owns — is ' +
      'rejected with 400, so a role cannot be smuggled in by editing the ' +
      'request body.\n\n' +
      'The ERP no longer creates these users; this database is the source of ' +
      'truth for them.\n\n' +
      '`region` is REQUIRED for OFFICER, LOADING_OFFICER and REGIONAL_ADMIN ' +
      'and must be OMITTED for ADMIN (organisation-wide).\n\n' +
      'Privileged columns (`id`, `isActive`, `erpCode`, `createdById`, …) are ' +
      'never taken from the body — unknown properties are rejected outright.\n\n' +
      'Side effect (US-15.3): the user is emailed their login credentials. ' +
      '`emailSent` reports whether delivery succeeded — the record is created ' +
      'either way, so the FE can soften its success wording instead of ' +
      'promising an email that never arrived.',
  })
  @ApiCreatedResponse({ type: CreatedOfficerDto })
  @ApiBadRequestResponse({
    description:
      'Validation failure, or a duplicate: `Email already in use` ' +
      '(`code: EMAIL_IN_USE`) / `Phone number already in use` ' +
      '(`code: PHONE_IN_USE`). Also `ROLE_NOT_SUPPORTED`, `REGION_REQUIRED` ' +
      'and `REGION_NOT_ALLOWED`.',
  })
  async createOfficer(
    @Body() dto: CreateOfficerDto,
    @CurrentUser() user: { id: string },
  ) {
    // The acting admin comes from the verified JWT, never from the body.
    return this.adminService.createOfficer(dto, { id: user.id });
  }

  @Get('officers/:id')
  @Roles('ADMIN', 'REGIONAL_ADMIN')
  @ApiOperation({
    summary: 'Officer detail — profile + portfolio (B-4.1)',
    description:
      'Profile, region, role, last login, plus `_count` (customers, open ' +
      'supportTickets, chatThreads) and the `customers` portfolio the ' +
      'Regional Portal renders beside it.\n\n' +
      'REGIONAL_ADMIN may read officers in their own region (403 outside it). ' +
      '`lastLoginAt` is null until first login — render "Never". ' +
      '`distributors` and `openTickets` remain as deprecated aliases of the ' +
      '`_count` fields.',
  })
  @ApiParam({ name: 'id', description: 'Officer UUID' })
  @ApiOkResponse({ type: OfficerDetailDto })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  async getOfficer(
    @CurrentUser() user: { role: string; region?: Region | null },
    @Param('id') id: string,
  ) {
    return this.adminService.getOfficerDetail(id, user);
  }

  // Declared BEFORE @Patch('officers/:id') so the literal 'bulk-region'
  // segment is not swallowed as an officer id.
  @Patch('officers/bulk-region')
  @ApiOperation({
    summary: 'Move a selection of officers to one region',
    description:
      'O-2 — the "Reassign Region" action over a checkbox selection on ' +
      '/admin/officers. Body `{ "officerIds": string[], "region": Region }`.\n\n' +
      'PER-OFFICER RESULTS, never all-or-nothing: moving nine officers and ' +
      'failing the tenth leaves the nine moved and names the tenth in ' +
      '`failed` with a `code` and `message`. There is deliberately no ' +
      'surrounding transaction.\n\n' +
      'Each move applies the same rules as PATCH /admin/officers/{id}: an ' +
      'ADMIN in the selection is refused with `REGION_NOT_ALLOWED` (they are ' +
      'organisation-wide) and an ERP-owned role with `ROLE_NOT_MANAGED`, ' +
      'while everyone else still moves.\n\n' +
      'Duplicate ids are collapsed. Maximum 500 per call.',
  })
  @ApiOkResponse({ type: BulkOperationResultDto })
  @ApiBadRequestResponse({
    description: 'Empty officerIds, more than 500 ids, or an unknown region',
  })
  async bulkOfficerRegion(@Body() dto: BulkOfficerRegionDto) {
    return this.adminService.bulkUpdateOfficerRegion(
      dto.officerIds,
      dto.region,
    );
  }

  @Patch('officers/:id')
  @ApiOperation({
    summary: 'Deactivate or reactivate an internally managed user',
    description:
      'ADMIN-only. `{"isActive": false}` deactivates, `{"isActive": true}` ' +
      'reactivates (US-15.4). Works for all four managed roles; a role this ' +
      'service does not own (WAREHOUSE_OFFICER) is refused with 400 ' +
      '`ROLE_NOT_MANAGED`.\n\n' +
      'IDEMPOTENT: sending the status the user already has returns 200 with ' +
      '`changed: false` and leaves the audit stamps alone, so a double-click ' +
      'or a concurrent retry is safe.\n\n' +
      'Deactivating an account officer is REFUSED with 409 while they still ' +
      'hold customers; the error body carries `code` and the exact ' +
      '`assignedCustomers` count so the admin can be told how many to move, ' +
      'then call PATCH /admin/officers/{id}/reassign-customers and retry. ' +
      'Deactivating the last active ADMIN is refused with 409 ' +
      '`LAST_ACTIVE_ADMIN`, and deactivating yourself with 400 ' +
      '`SELF_DEACTIVATION`.\n\n' +
      'On deactivation every outstanding refresh token is revoked in the same ' +
      'transaction and the still-valid access token stops working on the next ' +
      'request (US-15.5). Nothing is deleted — the account, its role, its ' +
      'region and its chat/ticket history all survive, and reactivation ' +
      'restores access with the same permissions.',
  })
  @ApiOkResponse({ type: OfficerStatusDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({
    description:
      '`ROLE_NOT_MANAGED` (ERP-owned role) or `SELF_DEACTIVATION`, or a ' +
      'missing / non-boolean `isActive`',
  })
  @ApiConflictResponse({
    description:
      'Officer still has assigned customers: `{ "message": "Reassign this ' +
      'officer\'s 14 customers before deactivating.", "code": ' +
      '"OFFICER_HAS_CUSTOMERS", "assignedCustomers": 14, "statusCode": 409 }` ' +
      '— or `LAST_ACTIVE_ADMIN`.',
  })
  async updateOfficerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOfficerStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    const { isActive, ...profile } = dto;
    const wantsProfileEdit = Object.values(profile).some(
      (v) => v !== undefined,
    );

    // O-1 — the profile edit runs FIRST, so that a body carrying both a
    // profile change and a deactivation cannot leave the user deactivated
    // with the edit lost: `setOfficerActive` is the one that can refuse with
    // 409 (customers still assigned), and if it does, the profile change has
    // already been applied and reported rather than silently dropped.
    const edited = wantsProfileEdit
      ? await this.adminService.updateOfficerProfile(id, profile)
      : null;

    if (isActive === undefined) {
      if (edited) return edited;
      // Neither half present: the body said nothing at all.
      throw new BadRequestException({
        message:
          'Send at least one of: isActive, name, phone, region, password.',
        code: 'EMPTY_UPDATE',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    const status = await this.adminService.setOfficerActive(id, isActive, {
      id: user.id,
    });
    // `changed` reports whether ANYTHING moved, across both halves.
    return edited
      ? { ...status, ...edited, changed: edited.changed || status.changed }
      : status;
  }

  @Patch('officers/:id/reassign-customers')
  @ApiOperation({
    summary:
      'Reassign ALL of an officer’s customers to another officer (do this before deactivating)',
    description:
      'Moves the primary pointer and the CustomerOfficer rows for every ' +
      'customer, so chat threads and tickets follow them (US-13.5). Side ' +
      'effect (US-13.4): one summary ASSIGNMENT notification for the ' +
      'receiving officer.',
  })
  @ApiOkResponse({ type: BulkReassignResponseDto })
  @ApiBadRequestResponse({
    description: 'Target officer is the same, inactive, or in another region',
  })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  async reassignAllCustomers(
    @Param('id') id: string,
    @Body() dto: ReassignOfficerDto,
  ) {
    return this.adminService.reassignAllCustomers(id, dto.newOfficerId);
  }

  // ─── Product Flyer ──────────────────────────
  @Get('product-flyers')
  @ApiOperation({
    summary: 'List product flyer cards in current order',
    description:
      'F-1 - every row carries `description`, the flyer’s own copy. It is ' +
      'null when the admin left it blank and on every flyer created before ' +
      'the column existed - never absent, never an error.',
  })
  @ApiOkResponse({ type: [ProductFlyerDto] })
  async listFlyers() {
    return this.adminService.listProductFlyers();
  }

  @Post('product-flyers')
  @ApiOperation({
    summary:
      'Create a product flyer card (uploads come pre-resolved as imageUrl)',
    description:
      'F-1 - `description` is OPTIONAL free text (max 500 chars), the ' +
      'promotion copy the artwork cannot carry as readable text. Omit it, or ' +
      'send an empty string, and the flyer is stored with ' +
      '`description: null`. It is trimmed on the way in and echoed back on ' +
      'the created flyer.',
  })
  @ApiOkResponse({ type: ProductFlyerDto })
  async createFlyer(
    @Body() dto: CreateProductFlyerDto,
    @CurrentUser() user: any,
  ) {
    return this.adminService.createProductFlyer(dto, user.id);
  }

  @Patch('product-flyers/reorder')
  @ApiOperation({
    summary: 'Reorder flyer cards — order in payload = order shown on mobile',
  })
  @ApiOkResponse({ type: [ProductFlyerDto] })
  async reorderFlyers(@Body() dto: ReorderProductFlyersDto) {
    return this.adminService.reorderProductFlyers(dto);
  }

  @Patch('product-flyers/:id')
  @ApiOperation({
    summary: 'Update / deactivate a flyer card',
    description:
      'F-1 - `description` follows the usual PATCH rule, with one addition ' +
      'the form relies on:\n' +
      '- omit the property entirely: the stored copy is left UNCHANGED;\n' +
      '- send `""`: the copy is CLEARED back to null;\n' +
      '- send text: the copy is replaced (trimmed, max 500 chars).',
  })
  @ApiOkResponse({ type: ProductFlyerDto })
  async updateFlyer(
    @Param('id') id: string,
    @Body() dto: UpdateProductFlyerDto,
  ) {
    return this.adminService.updateProductFlyer(id, dto);
  }

  @Delete('product-flyers/:id')
  @ApiOperation({ summary: 'Delete a flyer card permanently' })
  @ApiOkResponse({ type: MessageResponseDto })
  async deleteFlyer(@Param('id') id: string) {
    await this.adminService.deleteProductFlyer(id);
    return { message: 'Product flyer deleted' };
  }

  @Delete('officers/:id')
  @ApiOperation({
    summary: '[Deprecated] Deactivate an officer account',
    description:
      'Kept for existing clients. Prefer PATCH /admin/officers/{id} with ' +
      '`{"isActive": false}`, which uses the same rules but returns the ' +
      'updated officer and a machine-readable 409 when customers remain.',
    deprecated: true,
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiNotFoundResponse({ description: 'Officer not found' })
  @ApiConflictResponse({
    description: 'Officer still has assigned customers (OFFICER_HAS_CUSTOMERS)',
  })
  async deactivateOfficer(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.adminService.setOfficerActive(id, false, { id: user.id });
    return { message: 'Officer deactivated successfully' };
  }
}
