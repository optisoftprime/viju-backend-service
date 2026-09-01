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
import {
  AssignedCustomersFilterDto,
  OfficerChatsQueryDto,
} from './dto/officer-request.dto';
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
  PortfolioStockDto,
  PaginatedOfficerChatsResponseDto,
} from './dto/officer-response.dto';
// The distributor-facing DTOs, reused so the officer routes document exactly
// the shapes their reused readers return.
import {
  PurchaseDetailDto,
  ErpWaybillDetailDto,
} from '../customer/dto/customer-response.dto';
import {
  PurchaseFilterDto,
  StockBalanceFilterDto,
} from '../customer/dto/customer.dto';

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
    summary: 'Distributor Invoices tab - the distributor`s own order history',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3).\n\n' +
      'IDENTICAL to GET /customers/me/invoices for this distributor - same ' +
      'rows, same `{ data, meta }` envelope, same `page` / `pageSize` / ' +
      '`search` / `startDate` / `endDate`. It is served by the same reader, ' +
      'so the officer cannot be shown a different order history from the ' +
      'person whose account it is.\n\n' +
      'The rows carry NO line items: one row per order. Open one with GET ' +
      '/officers/customers/{id}/invoices/{invoiceId}.\n\n' +
      'CHANGED: the orders used to arrive under `invoices` as one unpaged ' +
      'array. They are now `data` + `meta`. `walletBalance` and ' +
      '`paymentHistory` are unchanged and still alongside.\n\n' +
      '`lastUpdated` is the most recent ERP sync across the balance, the ' +
      'whole order history and the payments (US-10.7) - not just the ' +
      'current page, so paging cannot move it.',
  })
  @ApiOkResponse({ type: CustomerInvoicesDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  async getCustomerInvoices(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() filter: PurchaseFilterDto,
  ) {
    return this.officerService.getCustomerInvoices(user, customerId, filter);
  }

  @Get('customers/:id/invoices/:invoiceId')
  @ApiOperation({
    summary: 'One order in full, with its product lines',
    description:
      'IDENTICAL to GET /customers/me/invoices/{id} for this distributor.\n\n' +
      'ONE LINE PER PRODUCT: the ERP writes a separate line whenever the ' +
      'same product is priced differently on one order - a priced line plus ' +
      'a zero-priced free-goods line, both under the same `itemCode` - and ' +
      'those are merged here. `quantity` and `amount` are the sums, so the ' +
      'lines still add up to `totalValue` exactly.\n\n' +
      'SCOPE IS CHECKED TWICE: the distributor must be in the caller`s ' +
      'portfolio, and the order must belong to that distributor. An order ' +
      'id from elsewhere paired with a customer id from the portfolio is a ' +
      '404, not a leak.',
  })
  @ApiOkResponse({ type: PurchaseDetailDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiParam({ name: 'invoiceId', description: 'Order id (Purchase.id)' })
  @ApiNotFoundResponse({
    description:
      'Customer not assigned to the caller, or no such order for that customer',
  })
  async getCustomerInvoiceDetail(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.officerService.getCustomerInvoiceDetail(
      user,
      customerId,
      invoiceId,
    );
  }

  @Get('customers/:id/stock')
  @ApiOperation({
    summary:
      'Distributor Stock tab - what they have paid for and not collected',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3).\n\n' +
      'IDENTICAL to GET /customers/me/stock-balance for this distributor, ' +
      'including the `startDate` / `endDate` window (both `YYYY-MM-DD`, both ' +
      'inclusive, either may be sent alone).\n\n' +
      'CHANGED: this used to return a `catalogue` of every product with ' +
      'reserved / awaiting-loading figures derived from the local Stock and ' +
      'Purchase tables - by a different route from the distributor`s own ' +
      'screen, so the two could disagree. It now returns the ERP-derived ' +
      'breakdown both portals share: `totalPurchasedCartons`, ' +
      '`totalLoadedCartons`, `totalRemainingCartons`, `loadingProgress` and ' +
      '`products`.\n\n' +
      'Only products with `quantityRemaining > 0` appear in `products`, so ' +
      'it does NOT sum to `totalPurchasedCartons`.',
  })
  @ApiOkResponse({ type: CustomerStockDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiNotFoundResponse({
    description: 'Customer not found, or not assigned to the calling officer',
  })
  @ApiBadRequestResponse({ description: '`startDate` is after `endDate`' })
  async getCustomerStock(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() filter: StockBalanceFilterDto,
  ) {
    return this.officerService.getCustomerStock(user, customerId, filter);
  }

  @Get('customers/:id/waybills')
  @ApiOperation({
    summary: 'Distributor Waybills tab - the ERP`s own goods-movement records',
    description:
      'OFFICER: only their own distributors. ADMIN: any distributor ' +
      '(US-12.3).\n\n' +
      'IDENTICAL to GET /customers/me/erp/waybills for this distributor: ' +
      'paginated `{ data, meta }`, newest first, read live from the ERP ' +
      'sales-order feed and rolled up to one row per document (DOC_NO).\n\n' +
      'CHANGED: this tab used to list the LOADING REQUESTS raised through ' +
      'the portal. Those are not lost - GET /officers/loading-requests is ' +
      'the officer`s view of them and carries the assign and cancel actions ' +
      'besides. This tab now answers what the distributor`s own Waybills ' +
      'screen answers: what the ERP recorded as moved.\n\n' +
      'Money fields are NULL - not 0 - wherever the ERP states none, which ' +
      'is most rows. Per-item detail is on ' +
      'GET /officers/customers/{id}/waybills/{docNo}.',
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

  @Get('customers/:id/waybills/:docNo')
  @ApiOperation({
    summary: 'One ERP goods-movement document, with its item lines',
    description:
      'IDENTICAL to GET /customers/me/erp/waybills/{docNo} for this ' +
      'distributor. The document keeps the shape it has in the list and ' +
      'gains `items` - one entry per ERP line row, in the ERP`s own order.\n\n' +
      'MONEY IS NULL, NOT 0, where the ERP states none: it carries per-line ' +
      'money on only ~6% of rows. Render a dash, not a zero.\n\n' +
      'A document belonging to another distributor answers 404, exactly as ' +
      'an unknown one does.',
  })
  @ApiOkResponse({ type: ErpWaybillDetailDto })
  @ApiParam({ name: 'id', description: 'Customer (distributor) id' })
  @ApiParam({
    name: 'docNo',
    description: 'The ERP document number (DOC_NO), e.g. 2300-202503070060',
  })
  @ApiNotFoundResponse({
    description:
      'Customer not assigned to the caller, or no such document for them',
  })
  async getCustomerWaybillDetail(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Param('docNo') docNo: string,
  ) {
    return this.officerService.getCustomerWaybillDetail(
      user,
      customerId,
      docNo,
    );
  }

  @Get('chats')
  @ApiOperation({
    summary: 'The officer’s conversation list',
    description:
      'CH-3 — one row per CONVERSATION, most recent first, for the whole ' +
      'portfolio.\n\n' +
      'A different resource from GET /officers/customers, not a filtered ' +
      'view of it: it carries only what a WhatsApp-style row renders — name, ' +
      'picture, excerpt, time, unread count — and omits the wallet balance, ' +
      'stock figure and ticket count that list derives. A customer the ' +
      'officer has never exchanged a message with does not appear, so there ' +
      'is nothing to filter client-side.\n\n' +
      'ORDERING IS ACROSS THE WHOLE PORTFOLIO, then paged — page 1 starts at ' +
      'the most recent conversation the officer has, not the most recent ' +
      'within some window of accounts. Rows with no message sink rather than ' +
      'float.\n\n' +
      '`search` matches name, account number and phone, exactly as it does ' +
      'on GET /officers/customers.\n\n' +
      'READ-ONLY: listing conversations does NOT mark anything read. Only ' +
      'opening a thread (GET /chat/{customerId}) does.\n\n' +
      'An ADMIN sees every conversation; an OFFICER sees their own portfolio ' +
      '(primary or secondary).',
  })
  @ApiOkResponse({ type: PaginatedOfficerChatsResponseDto })
  async getChats(
    @CurrentUser() user: any,
    @Query() query: OfficerChatsQueryDto,
  ) {
    return this.officerService.getChats(user, query);
  }

  @Get('stock')
  @ApiOperation({
    summary: 'Stock balance across the whole portfolio',
    description:
      'The SAME shape as GET /customers/me/stock-balance and ' +
      'GET /officers/customers/{id}/stock, summed across every distributor ' +
      'the caller can see - what is still to collect in the officer`s book ' +
      'of accounts.\n\n' +
      'Products are grouped ACROSS distributors, so a product several of ' +
      'them hold appears ONCE with the quantities added. The per-customer ' +
      'split is GET /officers/customers/{id}/stock.\n\n' +
      'SCOPE: an OFFICER sees the distributors assigned to them (primary or ' +
      'secondary); an ADMIN sees every distributor, matching their ' +
      'cross-region visibility elsewhere in this controller. `customers` ' +
      'reports how many were counted.\n\n' +
      'CHANGED: this used to be a paginated catalogue of ERP stock LEVELS ' +
      'with no customer context. It is now a stock BALANCE, which is what ' +
      'the distributor-facing screens mean by the term. It is not ' +
      'paginated: the breakdown is one row per product still held, a short ' +
      'list even across a whole portfolio.\n\n' +
      'Takes the same `startDate` / `endDate` window, both inclusive. An ' +
      'empty portfolio, an absent feed or an empty window all return honest ' +
      'zeros with an empty `products`.',
  })
  @ApiOkResponse({ type: PortfolioStockDto })
  @ApiBadRequestResponse({ description: '`startDate` is after `endDate`' })
  async getStock(
    @CurrentUser() user: any,
    @Query() filter: StockBalanceFilterDto,
  ) {
    return this.officerService.getStock(user, filter);
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
