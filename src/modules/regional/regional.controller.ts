import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RegionalService } from './regional.service';
import { AdminService } from '../admin/admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AssignLoadingOfficerDto,
  UpdateLoadingStatusDto,
  ListLoadingRequestsQueryDto,
} from './dto/regional.dto';
import { Region } from '../../common/region/region.constants';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { CustomerFilterDto } from '../admin/dto/admin.dto';
import { PaginatedCustomersResponseDto } from '../admin/dto/customer-response.dto';
import {
  RegionalDashboardResponseDto,
  PaginatedLoadingRequestsResponseDto,
  PaginatedRegionalLoadingQueueResponseDto,
  RegionalLoadingRequestDto,
} from './dto/regional-response.dto';

interface StaffUser {
  id: string;
  role: string;
  region: Region | null;
}

/**
 * CC-01 + RA-03: every route is role-gated server-side, and a regional admin
 * is always scoped to the region on their token — resolveRegion() below
 * refuses any attempt to widen that with a query param.
 */
@ApiTags('Regional Admin Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller lacks the role for this route, or asked for a region outside ' +
    'their own: `{ "message": "You do not have permission to perform this ' +
    'action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('regional')
export class RegionalController {
  constructor(
    private readonly regionalService: RegionalService,
    // Reused verbatim so the regional customer list and the admin one cannot
    // drift apart in shape, sorting or ERP-derived columns.
    private readonly adminService: AdminService,
  ) {}

  @Get('customers')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Every customer in the region (RA-C2)',
    description:
      'The regional admin Customers page. Returns exactly the same rows, in ' +
      'the same envelope, as GET /admin/customers - the shared customer table ' +
      'renders both - but the region is resolved from the caller instead of ' +
      'the query string.\n\n' +
      'REGIONAL_ADMIN: scoped to the region on their own record. `region` may ' +
      'be omitted entirely (do that) or repeated back as their OWN region; a ' +
      'different region is refused with 403. Unlike GET /admin/customers, ' +
      'sending your own region here is NOT an error.\n\n' +
      'ADMIN: has no home region, so `region` is REQUIRED - it is how an ' +
      'admin previews one region through this route. Use GET /admin/customers ' +
      'for the cross-region list.\n\n' +
      'Filters: `search` (name or erpId, case-insensitive, partial), ' +
      '`hasOfficer` (true = assigned only, false = unassigned only, omit for ' +
      'both), `sortBy` / `sortOrder`, `page` / `pageSize` (clamped to 200 - ' +
      'read `meta.pageSize` for what was applied), and `includeUnprojected` ' +
      'to add ERP customers in the region that the projector has not copied ' +
      'across yet.\n\n' +
      '`meta.total` always counts the rows THIS filter matches inside the ' +
      'region, so paging is arithmetically correct. A region with no ' +
      'customers returns `data: []` with a valid `meta`, never a 404.',
  })
  @ApiOkResponse({
    description: "Paginated list of the region's customers.",
    type: PaginatedCustomersResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  @ApiForbiddenResponse({
    description:
      'REGIONAL_ADMIN asked for another region, a REGIONAL_ADMIN has no ' +
      'region on their record, or an ADMIN omitted `region`',
  })
  async getRegionalCustomers(
    @CurrentUser() user: StaffUser,
    @Query() query: CustomerFilterDto,
  ) {
    const region = this.resolveRegion(user, query.region);
    return this.adminService.getAllCustomers({ ...query, region }, query);
  }

  @Get('dashboard')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Regional Admin dashboard',
    description:
      'Summary cards + pending loading-request queue (RA-02).\n\n' +
      'The region is derived from the token for a REGIONAL_ADMIN: passing a ' +
      'different `region` is refused with 403, so the scope cannot be widened ' +
      'from the client (RA-03). ADMIN has cross-region visibility and must ' +
      'pass `region` to choose one.\n\n' +
      '`pendingLoadingRequests` stays empty until distributors submit ' +
      'loading requests (RA-06).',
  })
  @ApiOkResponse({
    description: 'Regional summary cards and pending loading-request queue.',
    type: RegionalDashboardResponseDto,
  })
  async getDashboard(
    @CurrentUser() user: StaffUser,
    @Query('region') queryRegion?: Region,
  ) {
    const region = this.resolveRegion(user, queryRegion);
    return this.regionalService.getRegionalDashboard(region);
  }

  @Get('loading-requests')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Loading requests in the region (RA-06)',
    description:
      'Backs the regional Loading Requests table: waybill, distributor, ' +
      'order, truck, driver, submitted date, assigned officer and status.\n\n' +
      '`status` matches the FE filter tabs — PENDING | ASSIGNED | ' +
      'IN_PROGRESS | COMPLETED | ALL (the database spellings ' +
      'PENDING_ASSIGNMENT / LOADING_IN_PROGRESS are accepted too).\n\n' +
      'The region comes from the token for a REGIONAL_ADMIN, never from the ' +
      'query string (RA-03).\n\n' +
      'To populate the assign-officer picker, call ' +
      'GET /admin/officers?role=LOADING_OFFICER.',
  })
  @ApiOkResponse({
    description: 'Paginated loading requests in the region.',
    type: PaginatedLoadingRequestsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Unknown status filter or invalid pagination params',
  })
  async listRequests(
    @CurrentUser() user: StaffUser,
    @Query() query: ListLoadingRequestsQueryDto,
  ) {
    const region = this.resolveRegion(user, query.region);
    return this.regionalService.listRequestsByStatus(
      region,
      query.status ?? 'ALL',
      query,
    );
  }

  @Patch('loading-requests/:id/assign')
  @Roles('REGIONAL_ADMIN', 'ADMIN')
  @ApiOperation({
    summary: 'Assign a loading request to a loading / warehouse officer',
    description:
      'RA-06. The officer must be active and in the same region. Both the ' +
      'officer and the distributor are notified, and the load then appears ' +
      "in that officer's queue at GET /loading/queue.",
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({
    description: 'The updated loading request (now ASSIGNED).',
    type: RegionalLoadingRequestDto,
  })
  @ApiBadRequestResponse({
    description:
      'Already assigned, or the officer is inactive / outside the region',
  })
  @ApiNotFoundResponse({
    description: 'Loading request not found in your region',
  })
  async assignRequest(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: AssignLoadingOfficerDto,
  ) {
    const region = this.resolveRegion(user);
    return this.regionalService.assignLoadingRequest(region, user.id, id, dto);
  }

  @Get('my-loading-queue')
  @Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER', 'ADMIN')
  @ApiOperation({
    summary: '[Legacy] Loading / Warehouse Officer queue',
    description:
      'Returns only requests assigned to the current officer in ASSIGNED or ' +
      'LOADING_IN_PROGRESS state, in the raw row shape.\n\n' +
      'Prefer GET /loading/queue (LO-02), which returns the shape the ' +
      'loading-officer screens render and also includes completed loads.',
    deprecated: true,
  })
  @ApiOkResponse({
    description: 'Paginated queue of requests assigned to the current officer.',
    type: PaginatedRegionalLoadingQueueResponseDto,
  })
  async getMyQueue(
    @CurrentUser() user: StaffUser,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.regionalService.getMyLoadingQueue(user.id, pagination);
  }

  @Patch('loading-requests/:id/status')
  @Roles('LOADING_OFFICER', 'WAREHOUSE_OFFICER', 'ADMIN')
  @ApiOperation({
    summary: 'Loading Officer advances status + uploads waybill',
    description:
      'Enforces the same transitions as PATCH /loading/queue/{id}/status ' +
      '(ASSIGNED → LOADING_IN_PROGRESS → COMPLETED); an illegal move is ' +
      'refused with 409. Requires `waybillDocumentUrl` when completing ' +
      '(PRD F13 AC3) — the newer POST /loading/queue/{id}/waybill records ' +
      'truck, driver and quantity alongside the document.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({
    description: 'The updated loading request with its new status.',
    type: RegionalLoadingRequestDto,
  })
  @ApiBadRequestResponse({
    description: 'waybillDocumentUrl missing when completing the load',
  })
  @ApiNotFoundResponse({ description: 'Loading request not found' })
  @ApiConflictResponse({
    description:
      'Illegal transition: `{ "message": "A completed load cannot be ' +
      'reopened.", "code": "INVALID_STATUS_TRANSITION", "statusCode": 409 }`',
  })
  async updateStatus(
    @CurrentUser() user: StaffUser,
    @Param('id') id: string,
    @Body() dto: UpdateLoadingStatusDto,
  ) {
    return this.regionalService.updateLoadingStatus(user.id, id, dto);
  }

  /**
   * Regional admin / officer scopes are restricted to their assigned
   * region. ADMIN can override via ?region= query param.
   */
  private resolveRegion(user: StaffUser, queryRegion?: Region): Region {
    if (user.role === 'ADMIN') {
      if (!queryRegion)
        throw new ForbiddenException(
          'Admin must specify ?region= for regional endpoints.',
        );
      return queryRegion;
    }
    if (!user.region)
      throw new ForbiddenException(
        'Your account has no region assigned. Contact admin.',
      );
    if (queryRegion && queryRegion !== user.region)
      throw new ForbiddenException(
        'You cannot access data outside your assigned region.',
      );
    return user.region;
  }
}
