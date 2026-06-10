import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Query,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { StatementService } from './statement.service';
import { Res } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  UpdateProfilePhotoDto,
  ChangePasswordDto,
  PurchaseFilterDto,
  StatementRangeDto,
} from './dto/customer.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { MessageResponseDto } from '../../common/dto/message-response.dto';
import {
  HomeResponseDto,
  StockBalanceBreakdownDto,
  CustomerProfileDto,
  PaginatedPurchasesResponseDto,
  PurchaseDetailDto,
  PaginatedPaymentsResponseDto,
  InvoicesResponseDto,
  InvoiceDetailDto,
} from './dto/customer-response.dto';

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly statementService: StatementService,
  ) {}

  @Get('me/home')
  @ApiOperation({
    summary: 'Mobile home screen aggregate',
    description:
      'Returns the four blocks the home screen needs in one call: ' +
      'Account Balance card, Stock Balance card, scrollable product flyers, ' +
      'and the last 5 purchases. Stock balance is derived from purchases minus ' +
      'completed loading-request quantities.',
  })
  @ApiOkResponse({ type: HomeResponseDto })
  async getHome(@CurrentUser() user: any) {
    return this.customerService.getHome(user.id);
  }

  @Get('me/stock-balance')
  @ApiOperation({
    summary: 'Stock Balance per-product breakdown',
    description:
      'Returns paid / loaded / remaining quantities per product, shown when ' +
      'the distributor taps the Stock Balance card. Loaded qty is apportioned ' +
      'across products on each purchase proportionally to ordered quantity ' +
      '(mocked until ERP exposes per-product loading detail).',
  })
  @ApiOkResponse({ type: StockBalanceBreakdownDto })
  async getStockBalance(@CurrentUser() user: any) {
    return this.customerService.getStockBalanceBreakdown(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current customer profile and balance' })
  @ApiOkResponse({ type: CustomerProfileDto })
  async getProfile(@CurrentUser() user: any) {
    return this.customerService.getProfile(user.id);
  }

  @Patch('me/photo')
  @ApiOperation({ summary: 'Update customer profile photo' })
  @ApiOkResponse({ type: CustomerProfileDto })
  async updatePhoto(
    @CurrentUser() user: any,
    @Body() dto: UpdateProfilePhotoDto,
  ) {
    return this.customerService.updatePhoto(user.id, dto);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change customer password' })
  @ApiOkResponse({ type: MessageResponseDto })
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.customerService.changePassword(user.id, dto);
    return { message: 'Password updated successfully' };
  }

  @Get('me/purchases')
  @ApiOperation({ summary: 'Get customer purchase history' })
  @ApiOkResponse({ type: PaginatedPurchasesResponseDto })
  async getPurchases(
    @CurrentUser() user: any,
    @Query() filter: PurchaseFilterDto,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getPurchases(user.id, filter, pagination);
  }

  @Get('me/purchases/:id')
  @ApiOperation({
    summary: 'Order detail with line items + linked invoice',
    description:
      'Tapping any order on the Payment tab opens this detail view: ' +
      'individual product lines, status, and the derived invoice number. ' +
      'Invoice number is generated from the order ERP id until ERP supplies ' +
      'the real link.',
  })
  @ApiOkResponse({ type: PurchaseDetailDto })
  async getPurchaseDetail(
    @CurrentUser() user: any,
    @Param('id') purchaseId: string,
  ) {
    return this.customerService.getPurchaseDetail(user.id, purchaseId);
  }

  @Get('me/payments')
  @ApiOperation({ summary: 'Get customer payment history' })
  @ApiOkResponse({ type: PaginatedPaymentsResponseDto })
  async getPayments(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getPayments(user.id, pagination);
  }

  @Get('me/invoices')
  @ApiOperation({
    summary: 'Invoice tab aggregate',
    description:
      'Returns wallet balance, full invoice list with derived statuses ' +
      '(Paid / Part Paid / Unpaid), and payment history with running ' +
      'balance. Read-only — no Pay-Now action exists.',
  })
  @ApiOkResponse({ type: InvoicesResponseDto })
  async getInvoices(@CurrentUser() user: any) {
    return this.customerService.getInvoices(user.id);
  }

  @Get('me/account-statement.pdf')
  @ApiOperation({
    summary: 'Generate Account Statement PDF',
    description:
      'Returns a binary PDF (Content-Type: application/pdf) containing ' +
      'invoices, payments, and running wallet balance for the date range. ' +
      'Omit dates to get the full lifetime statement.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Binary PDF account statement',
    schema: { type: 'string', format: 'binary' },
  })
  async getAccountStatement(
    @CurrentUser() user: any,
    @Query() range: StatementRangeDto,
    @Res() res: Response,
  ) {
    const buf = await this.statementService.generateAccountStatement(
      user.id,
      range,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-account-statement.pdf"',
    );
    res.send(buf);
  }

  @Get('me/stock-statement.pdf')
  @ApiOperation({
    summary: 'Generate Stock Statement PDF',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Binary PDF stock statement',
    schema: { type: 'string', format: 'binary' },
  })
  async getStockStatement(
    @CurrentUser() user: any,
    @Query() range: StatementRangeDto,
    @Res() res: Response,
  ) {
    const buf = await this.statementService.generateStockStatement(
      user.id,
      range,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="viju-stock-statement.pdf"',
    );
    res.send(buf);
  }

  @Get('me/invoices/:id')
  @ApiOperation({
    summary: 'Invoice detail with line items',
    description:
      'Tapping any invoice opens this detail view: line items, quantities, ' +
      'unit prices, line totals, tax, grand total.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  async getInvoiceDetail(
    @CurrentUser() user: any,
    @Param('id') invoiceId: string,
  ) {
    return this.customerService.getInvoiceDetail(user.id, invoiceId);
  }
}
