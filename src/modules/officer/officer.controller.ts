import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
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
import { Prisma } from '@prisma/client';
import { OfficerService } from './officer.service';
import { RegionalService } from '../regional/regional.service';
import {
  AssignLoadingOfficerDto,
  ListLoadingRequestsQueryDto,
} from '../regional/dto/regional.dto';
import {
  PaginatedLoadingRequestsResponseDto,
  RegionalLoadingRequestDto,
} from '../regional/dto/regional-response.dto';
import { CancelLoadingRequestDto } from '../loading/dto/loading.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { AssignedCustomersFilterDto } from './dto/officer-request.dto';
import { Query } from '@nestjs/common';
import {
  OfficerDashboardSummaryDto,
  PaginatedAssignedCustomersResponseDto,
  CustomerDetailDto,
  CustomerOverviewDto,
  PaginatedCustomerOrdersResponseDto,
  CustomerInvoicesDto,
  CustomerStockDto,
  PaginatedCustomerWaybillsResponseDto,
  PaginatedStockResponseDto,
} from './dto/officer-response.dto';

/**
 * A-1 — the signed-in staff member, as the controller reads it off the JWT.
 *
 * `role` decides the loading-request scope: an OFFICER is held to their own
 * portfolio, an ADMIN is not. It is read from the token and never from a
 * parameter, so a caller cannot widen their own scope.
 */
interface OfficerActor {
  id: string;
  role: string;
}

/**
 * CC-01: OFFICER and ADMIN only, enforced server-side on every route.
 * Officers are further scoped to their own portfolio inside the service;
 * ADMIN has cross-region visibility (US-12.3), so an administrator opens any
 * distributor's tabs through these same routes and gets byte-identical
 * responses — the FE reuses OverviewSection, OrdersSection, InvoicesSection,
 * StockSection and WaybillsSection unchanged.
 */
@ApiTags('Officer Portal')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is neither OFFICER nor ADMIN: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OFFICER', 'ADMIN')
@Controller('officers')
export class OfficerController {
  constructor(
    private readonly officerService: OfficerService,
    private readonly regionalService: RegionalService,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Officer dashboard summary cards',
    description:
      'Returns the four top-of-page cards: total distributors, overdue ' +
      'balances, open tickets, unread messages — all scoped to the ' +
      'officer’s portfolio.\n\n' +
      'AO-C1: "portfolio" means the customers this officer manages as ' +
      'primary OR secondary — the same set GET /officers/customers returns. ' +
      'Every tile therefore counts exactly the rows the list shows, so ' +
      'clicking a tile and landing on the filtered list can never disagree ' +
      'with the number that was clicked.',
  })
  @ApiOkResponse({ type: OfficerDashboardSummaryDto })
  async getDashboard(@CurrentUser() user: any) {
    return this.officerService.getDashboardSummary(user.id);
  }

  @Get('customers')
  @ApiOperation({
    summary: 'Get list of customers assigned to the officer (search + filters)',
    description:
      'OFFICER role: returns customers where they are primary OR secondary ' +
      'officer. ADMIN role: returns all customers across all regions ' +
      '(cross-region visibility).\n\n' +
      'AO-P1 - always the standard `{ data, meta }` envelope. `meta` carries ' +
      'total | page | pageSize | totalPages | hasNextPage | hasPreviousPage, ' +
      '`pageSize` is echoed back AS APPLIED (any positive integer is ' +
      'accepted and clamped to 200 rather than rejected), and `meta.total` ' +
      'counts the rows the current filter matches - so the pager is ' +
      'arithmetically correct without any client-side counting. This route ' +
      'is never an unpaginated array.\n\n' +
      'Filters: `search` matches name, account number (erpId) AND phone, ' +
      'case-insensitive and partial, applied SERVER-SIDE; `overdue=true` ' +
      '(negative balance); `activeTickets=true` (has open support tickets); ' +
      '`unreadMessages=true` (AO-C1 - has at least one unread message from ' +
      'the distributor, the "waiting on me" list).\n\n' +
      'Each row carries the three triage signals the dashboard tiles drill ' +
      'into: `openTickets`, `unreadMessages` (AO-C1, with `lastMessageAt`) ' +
      'and `stockBalanceCartons` (AO-P2, the same figure ' +
      'GET /admin/customers returns).\n\n' +
      'Sortable (US-09.3): `sortBy` accepts name | accountNumber | ' +
      'walletBalance | lastPurchaseDate | openTickets | lastContactDate | ' +
      'unreadMessages | lastMessageAt, with `sortOrder` (asc | desc, default ' +
      'desc). Omitting `sortBy` keeps the existing ordering (name ascending); ' +
      'an unknown `sortBy` is rejected with 400. Only the row order changes.',
  })
  @ApiOkResponse({ type: PaginatedAssignedCustomersResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown sortBy / sortOrder, or invalid pagination params',
  })
  async getCustomers(
    @CurrentUser() user: any,
    @Query() query: AssignedCustomersFilterDto,
  ) {
    return this.officerService.getAssignedCustomers(user, query);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary:
      'Legacy aggregate detail (kept for backwards compat) — prefer the per-tab endpoints',
  })
  @ApiOkResponse({ type: CustomerDetailDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerDetail(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerDetail(user, customerId);
  }

  @Get('customers/:id/overview')
  @ApiOperation({
    summary: 'Distributor Overview tab',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3). Carries the `lastUpdated` stamp required on every screen ' +
      'showing ERP data (PRD §7, US-10.7).',
  })
  @ApiOkResponse({ type: CustomerOverviewDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerOverview(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerOverview(user, customerId);
  }

  @Get('customers/:id/orders')
  @ApiOperation({
    summary: 'Distributor Orders tab',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3). Top-level `lastUpdated` is the last ERP sync for this ' +
      "customer's orders — not the time of the request (US-10.7).",
  })
  @ApiOkResponse({ type: PaginatedCustomerOrdersResponseDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerOrders(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.officerService.getCustomerOrders(user, customerId, pagination);
  }

  @Get('customers/:id/invoices')
  @ApiOperation({
    summary: 'Distributor Invoices tab',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3). `lastUpdated` is the most recent ERP sync across the ' +
      'balance, invoices and payments that make up this tab (US-10.7).',
  })
  @ApiOkResponse({ type: CustomerInvoicesDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerInvoices(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerInvoices(user, customerId);
  }

  @Get('customers/:id/stock')
  @ApiOperation({
    summary: 'Distributor Stock tab',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3). `lastUpdated` is the last ERP stock sync (US-10.7).',
  })
  @ApiOkResponse({ type: CustomerStockDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerStock(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerStock(user, customerId);
  }

  @Get('customers/:id/waybills')
  @ApiOperation({
    summary: 'Distributor Waybills tab',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      "(US-12.3). `lastUpdated` is the last sync of this customer's loading " +
      'requests (US-10.7).',
  })
  @ApiOkResponse({ type: PaginatedCustomerWaybillsResponseDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerWaybills(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.officerService.getCustomerWaybills(
      user,
      customerId,
      pagination,
    );
  }

  @Get('stock')
  @ApiOperation({ summary: 'Get current stock levels from the ERP' })
  @ApiOkResponse({ type: PaginatedStockResponseDto })
  async getStock(@Query() pagination: PaginationQueryDto) {
    return this.officerService.getStock(pagination);
  }

  // ─── A-1: the account officer's loading requests ───────────────────────
  //
  // Mirrors /regional/loading-requests exactly — same query params, same row
  // shape, same meta, same bodies — and is served by the SAME service methods,
  // so the two portals cannot drift. ONLY the scope differs: a regional admin
  // sees their whole region; an account officer sees the loading requests of
  // the customers assigned to them, resolved from their own staff record and
  // never from a query param.
  //
  // An ADMIN reaching these routes is deliberately NOT narrowed to a
  // portfolio — they have cross-region visibility everywhere else in this
  // controller, and narrowing here would hide loads from them.

  @Get('loading-requests')
  @ApiOperation({
    summary: "The account officer's loading requests",
    description:
      'A-1 — identical envelope to GET /regional/loading-requests: same ' +
      '`page`, `pageSize`, `search` and `status` params, same row shape, same ' +
      '`meta`.\n\n' +
      'Scope is the customers assigned to the signed-in officer (primary or ' +
      'secondary), read from the token — there is no officerId parameter, so ' +
      'one officer cannot read another’s work. An ADMIN sees every request.\n\n' +
      'Rows carry `description` (L-2) and `cancelledAt` / `cancelReason` (L-1).',
  })
  @ApiOkResponse({ type: PaginatedLoadingRequestsResponseDto })
  async listLoadingRequests(
    @CurrentUser() user: OfficerActor,
    @Query() query: ListLoadingRequestsQueryDto,
  ) {
    return this.regionalService.listRequestsScoped(
      this.loadingScope(user),
      query.status ?? 'ALL',
      query,
    );
  }

  @Patch('loading-requests/:id/assign')
  @ApiOperation({
    summary: 'Assign one of my loading requests to a loading officer',
    description:
      'A-1 — the same rules as the regional admin’s assign: the loading ' +
      'officer must be ACTIVE and in the REQUEST’s region, and both they and ' +
      'the distributor are notified. The load then appears in that officer’s ' +
      'queue at GET /loading/queue.\n\n' +
      'Populate the picker from ' +
      'GET /admin/officers?role=LOADING_OFFICER&isActive=true (A-2), which an ' +
      'account officer may now call.\n\n' +
      'Limited to loading requests raised by customers assigned to the caller.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({ type: RegionalLoadingRequestDto })
  @ApiBadRequestResponse({
    description:
      'Already assigned, or the officer is inactive / outside the request’s region',
  })
  @ApiNotFoundResponse({
    description: 'Loading request not found in your portfolio',
  })
  async assignLoadingRequest(
    @CurrentUser() user: OfficerActor,
    @Param('id') id: string,
    @Body() dto: AssignLoadingOfficerDto,
  ) {
    return this.regionalService.assignLoadingRequestScoped(
      this.loadingScope(user),
      user.id,
      id,
      dto,
    );
  }

  @Patch('loading-requests/:id/cancel')
  @ApiOperation({
    summary: 'Cancel one of my loading requests',
    description:
      'A-1 / L-1 — legal from PENDING, ASSIGNED and IN_PROGRESS; a COMPLETED ' +
      'load is final and answers 409 INVALID_STATUS_TRANSITION.\n\n' +
      'Body `{ "reason"?: string }` — optional; omit it rather than sending a ' +
      'blank string. Both the distributor and the assigned loading officer ' +
      'are notified.\n\n' +
      'Limited to loading requests raised by customers assigned to the caller.',
  })
  @ApiParam({ name: 'id', description: 'Loading request id' })
  @ApiOkResponse({ type: RegionalLoadingRequestDto })
  @ApiNotFoundResponse({
    description: 'Loading request not found in your portfolio',
  })
  @ApiConflictResponse({
    description:
      'Terminal state: `{ "message": "A completed load cannot be reopened.", ' +
      '"code": "INVALID_STATUS_TRANSITION", "statusCode": 409 }`',
  })
  async cancelLoadingRequest(
    @CurrentUser() user: OfficerActor,
    @Param('id') id: string,
    @Body() dto: CancelLoadingRequestDto,
  ) {
    return this.regionalService.cancelLoadingRequest(
      this.loadingScope(user),
      user.id,
      id,
      dto.reason,
    );
  }

  /**
   * The WHERE that limits a loading request to the caller's own portfolio.
   *
   * Mirrors OfficerService.ensureAssignedCustomer and the chat module's
   * `isAssignedPair`: a customer counts as the officer's whether they hold
   * them as PRIMARY (`assignedOfficerId`) or SECONDARY (`CustomerOfficer`),
   * so a reassignment never hides a load from the officer who now owns it.
   *
   * An ADMIN is unscoped — cross-region visibility, as everywhere else here.
   */
  private loadingScope(user: OfficerActor): Prisma.LoadingRequestWhereInput {
    if (user.role === 'ADMIN') return {};
    return {
      customer: {
        OR: [
          { assignedOfficerId: user.id },
          { officerAssignments: { some: { staffId: user.id } } },
        ],
      },
    };
  }
}
