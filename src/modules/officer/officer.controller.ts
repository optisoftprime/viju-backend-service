import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { OfficerService } from './officer.service';
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
  constructor(private readonly officerService: OfficerService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Officer dashboard summary cards',
    description:
      'Returns the four top-of-page cards: total distributors, overdue ' +
      'balances, open tickets, unread messages — all scoped to the ' +
      'officer’s portfolio.',
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
      '(cross-region visibility). Supports `search` (name / account number / ' +
      'phone), `overdue=true` (negative balance), and `activeTickets=true` ' +
      '(has open support tickets).\n\n' +
      'Sortable (US-09.3): `sortBy` accepts name | accountNumber | ' +
      'walletBalance | lastPurchaseDate | openTickets | lastContactDate, ' +
      'with `sortOrder` (asc | desc, default desc). Omitting `sortBy` keeps ' +
      'the existing ordering (name ascending); an unknown `sortBy` is ' +
      'rejected with 400. Only the row order changes.',
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
}
