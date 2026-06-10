import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { OfficerService } from './officer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
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

@ApiTags('Officer Portal')
@ApiBearerAuth()
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
    summary: 'Get list of customers assigned to the officer',
    description:
      'OFFICER role: returns customers where they are primary OR secondary ' +
      'officer. ADMIN role: returns all customers across all regions ' +
      '(cross-region visibility).',
  })
  @ApiOkResponse({ type: PaginatedAssignedCustomersResponseDto })
  async getCustomers(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.officerService.getAssignedCustomers(user, pagination);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary:
      'Legacy aggregate detail (kept for backwards compat) — prefer the per-tab endpoints',
  })
  @ApiOkResponse({ type: CustomerDetailDto })
  async getCustomerDetail(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerDetail(user.id, customerId);
  }

  @Get('customers/:id/overview')
  @ApiOperation({ summary: 'Distributor Overview tab' })
  @ApiOkResponse({ type: CustomerOverviewDto })
  async getCustomerOverview(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerOverview(user.id, customerId);
  }

  @Get('customers/:id/orders')
  @ApiOperation({ summary: 'Distributor Orders tab' })
  @ApiOkResponse({ type: PaginatedCustomerOrdersResponseDto })
  async getCustomerOrders(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.officerService.getCustomerOrders(
      user.id,
      customerId,
      pagination,
    );
  }

  @Get('customers/:id/invoices')
  @ApiOperation({ summary: 'Distributor Invoices tab' })
  @ApiOkResponse({ type: CustomerInvoicesDto })
  async getCustomerInvoices(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerInvoices(user.id, customerId);
  }

  @Get('customers/:id/stock')
  @ApiOperation({ summary: 'Distributor Stock tab' })
  @ApiOkResponse({ type: CustomerStockDto })
  async getCustomerStock(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerStock(user.id, customerId);
  }

  @Get('customers/:id/waybills')
  @ApiOperation({ summary: 'Distributor Waybills tab' })
  @ApiOkResponse({ type: PaginatedCustomerWaybillsResponseDto })
  async getCustomerWaybills(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.officerService.getCustomerWaybills(
      user.id,
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
