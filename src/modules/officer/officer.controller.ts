import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OfficerService } from './officer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Officer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OFFICER', 'ADMIN')
@Controller('officers')
export class OfficerController {
  constructor(private readonly officerService: OfficerService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Officer dashboard summary cards (PRD F9)',
    description:
      'Returns the four top-of-page cards: total distributors, overdue ' +
      'balances, open tickets, unread messages — all scoped to the ' +
      'officer’s portfolio.',
  })
  async getDashboard(@CurrentUser() user: any) {
    return this.officerService.getDashboardSummary(user.id);
  }

  @Get('customers')
  @ApiOperation({
    summary: 'Get list of customers assigned to the officer',
    description:
      'OFFICER role: returns customers where they are primary OR secondary ' +
      'officer (PRD F6). ADMIN role: returns all customers across all regions ' +
      '(PRD F14 cross-region visibility).',
  })
  async getCustomers(@CurrentUser() user: any) {
    return this.officerService.getAssignedCustomers(user);
  }

  @Get('customers/:id')
  @ApiOperation({
    summary:
      'Legacy aggregate detail (kept for backwards compat) — prefer the per-tab endpoints',
  })
  async getCustomerDetail(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerDetail(user.id, customerId);
  }

  @Get('customers/:id/overview')
  @ApiOperation({ summary: 'Distributor Overview tab (PRD F10)' })
  async getCustomerOverview(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerOverview(user.id, customerId);
  }

  @Get('customers/:id/orders')
  @ApiOperation({ summary: 'Distributor Orders tab (PRD F10)' })
  async getCustomerOrders(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerOrders(user.id, customerId);
  }

  @Get('customers/:id/invoices')
  @ApiOperation({ summary: 'Distributor Invoices tab (PRD F10)' })
  async getCustomerInvoices(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerInvoices(user.id, customerId);
  }

  @Get('customers/:id/stock')
  @ApiOperation({ summary: 'Distributor Stock tab (PRD F10)' })
  async getCustomerStock(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerStock(user.id, customerId);
  }

  @Get('customers/:id/waybills')
  @ApiOperation({ summary: 'Distributor Waybills tab (PRD F10)' })
  async getCustomerWaybills(
    @CurrentUser() user: any,
    @Param('id') customerId: string,
  ) {
    return this.officerService.getCustomerWaybills(user.id, customerId);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Get current stock levels from the ERP' })
  async getStock() {
    return this.officerService.getStock();
  }
}
