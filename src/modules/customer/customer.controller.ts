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
import { StatementLedgerService } from './statement-ledger.service';
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
  CustomerOfficerChatItemDto,
  StockBalanceBreakdownDto,
  CustomerProfileDto,
  PaginatedPurchasesResponseDto,
  PurchaseDetailDto,
  PaginatedPaymentsResponseDto,
  InvoicesResponseDto,
  InvoiceDetailDto,
  StatementResponseDto,
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
    private readonly ledger: StatementLedgerService,
  ) {}

  @Get('me/statement')
  @ApiOperation({
    summary: 'Account statement (JSON)',
    description:
      'B-5.1 / B-5.2 / B-5.5 — the statement as data, so the app renders ' +
      'labels from the payload instead of hardcoding them.\n\n' +
      'Movements are kept distinct by `type`: INVOICE, PAYMENT and ' +
      'TRANSPORT_ALLOWANCE (a payment settling a delivery allowance). ' +
      '`debit`/`credit` are always numbers, never null.\n\n' +
      '`runningBalance` is computed server-side in strict chronological ' +
      'order, with `openingBalance` and `closingBalance` on the envelope, so ' +
      'web, mobile and the PDF cannot disagree. For any window ' +
      '`closingBalance = openingBalance + Σ(credit) − Σ(debit)`. Ties on the ' +
      'same timestamp are broken by movement type then id.\n\n' +
      'Windows: `period=LAST_30_DAYS | LAST_90_DAYS | LAST_6_MONTHS | ' +
      'YEAR_TO_DATE | CUSTOM`, defaulting to LAST_30_DAYS. `startDate` and ' +
      '`endDate` are required for CUSTOM; an inverted range is a 400.',
  })
  @ApiOkResponse({ type: StatementResponseDto })
  async getStatement(
    @CurrentUser() user: any,
    @Query() query: StatementRangeDto,
  ) {
    return this.ledger.build(user.id, this.ledger.resolvePeriod(query));
  }

  @Get('me/chats')
  @ApiOperation({
    summary: 'The distributor’s account officers, as a chat list',
    description:
      'One row per ACCOUNT OFFICER assigned to the caller, most recently ' +
      'active first - the mirror of GET /officers/chats, from the ' +
      'distributor’s side.\n\n' +
      'This endpoint NAMES the officer. Every other customer-facing surface ' +
      'renders staff as the generic "Viju Account Officer" (PRD F6); a ' +
      'distributor picking who to message cannot do so when everyone is ' +
      'called the same thing, so `name` and `avatarUrl` are exposed here.\n\n' +
      'Unlike the officer version, an officer the distributor has NEVER ' +
      'messaged still appears, with nulls for the preview and time: this is a ' +
      'list of people to start a conversation with, not only of conversations ' +
      'that exist. Deactivated officers are omitted - they cannot reply.\n\n' +
      'Open a thread with GET /chat/{officerId} and reply with ' +
      'POST /chat/{officerId}, using the `officerId` from a row. ' +
      'PATCH /chat/me/read clears the unread counts.\n\n' +
      'READ-ONLY: listing does not mark anything read.',
  })
  @ApiOkResponse({ type: [CustomerOfficerChatItemDto] })
  async getOfficerChats(@CurrentUser() user: any) {
    return this.customerService.getOfficerChats(user.id);
  }

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
    @Query() query: PurchaseFilterDto,
  ) {
    return this.customerService.getPurchases(user.id, query, query);
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
      'invoices, payments, and running wallet balance for the window.\n\n' +
      'B-5.2 — accepts the same `period` presets as GET /customers/me/statement ' +
      '(LAST_30_DAYS by default), or an explicit startDate/endDate range.',
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
    // B-5.2 — the download honours the same period presets as the JSON
    // statement, so "Last 30 Days" means the same thing in both.
    const period = this.ledger.resolvePeriod(range);
    const buf = await this.statementService.generateAccountStatement(user.id, {
      startDate: period.from.toISOString(),
      endDate: period.to.toISOString(),
    });
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
    const period = this.ledger.resolvePeriod(range);
    const buf = await this.statementService.generateStockStatement(user.id, {
      startDate: period.from.toISOString(),
      endDate: period.to.toISOString(),
    });
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
