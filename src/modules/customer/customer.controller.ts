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
  ApiParam,
  ApiNotFoundResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import {
  COLLECTION_RECORD,
  RECEIVABLE_RECORD,
  REFUND_RECORD,
} from '../erp/erp-financial-records';
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
  PaginatedErpWaybillsResponseDto,
  ErpWaybillDetailDto,
  ErpFinancialRecordDto,
  PaginatedErpFinancialRecordsResponseDto,
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
      'Rows carry the officer’s real name and picture, as every ' +
      'customer-facing surface now does, so a distributor can tell their ' +
      'officers apart and pick who to message.\n\n' +
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

  @Get('me/erp/waybills')
  @ApiOperation({
    summary: 'The ERP’s own goods-movement records',
    description:
      'Paginated `{ data, meta }`, newest first, read live from the ERP ' +
      'sales-order feed for the signed-in distributor.\n\n' +
      'A DIFFERENT RESOURCE from GET /customers/me/waybills, not a filtered ' +
      'view of it: that route lists the loading requests raised through this ' +
      'app, this one lists what the ERP itself holds, whether or not it ever ' +
      'passed through the portal.\n\n' +
      '`raw_sales_order` is one row PER ORDER LINE, so rows are rolled up to ' +
      'one per document (DOC_NO) - the thing a waybill actually is. `lines` ' +
      'reports how many line rows each document collapsed.\n\n' +
      '`status` is derived with the same precedence the order reconciler ' +
      'uses, so it cannot disagree with the order list.\n\n' +
      'Each document carries `quantity` (QTY_TOTAL - a DOCUMENT-level figure ' +
      'the feed repeats per line, so it is NOT the sum of the items), plus ' +
      '`totalAmountBeforeTax` (sum of the lines’ AMOUNT), `taxVat` (summed ' +
      'per line as AMOUNT x TAX_RATE, since the rate can vary by line) and ' +
      '`totalAmountAfterTax`. All four are NULL - not 0 - where the ERP ' +
      'states no money, which is the majority of rows.\n\n' +
      'Per-item `description`, `specification` and `price` live on ' +
      'GET /customers/me/erp/waybills/{docNo}: 96.5% of documents carry more ' +
      'than one item, so they cannot be single values here.\n\n' +
      'An absent ERP feed or an unknown customer returns an empty page with ' +
      'a valid `meta`, never an error.',
  })
  @ApiOkResponse({ type: PaginatedErpWaybillsResponseDto })
  async getErpWaybills(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getErpWaybills(user.id, pagination);
  }

  @Get('me/erp/waybills/:docNo')
  @ApiOperation({
    summary: 'One ERP goods-movement document, with its item lines',
    description:
      'The detail behind a row of GET /customers/me/erp/waybills. The ' +
      'document keeps the same shape it has in the list, and gains `items` - ' +
      'one entry per ERP line row, in the ERP’s own order.\n\n' +
      'Per item: `itemCode` (ITEM_CODE), `description` (ITEM_DESCRIPTION), ' +
      '`specification` (ITEM_SPECIFICATION with the Chinese category ' +
      'characters removed), `price` (PRICE), `quantity` (BUSINESS_QTY, this ' +
      'line’s own), and `totalAmountBeforeTax` / `taxVat` / ' +
      '`totalAmountAfterTax`.\n\n' +
      'MONEY IS NULL, NOT 0, where the ERP states none - it carries per-line ' +
      'money on only ~6% of rows. Treat null as "not stated" and render a ' +
      'dash rather than a zero.\n\n' +
      'A document belonging to another distributor answers 404, exactly as an ' +
      'unknown one does.',
  })
  @ApiParam({
    name: 'docNo',
    description: 'The ERP document number (DOC_NO), e.g. 2300-202503070060.',
  })
  @ApiOkResponse({ type: ErpWaybillDetailDto })
  @ApiNotFoundResponse({ description: 'No such document for this distributor' })
  async getErpWaybillDetail(
    @CurrentUser() user: any,
    @Param('docNo') docNo: string,
  ) {
    return this.customerService.getErpWaybillDetail(user.id, docNo);
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
      '(mocked until ERP exposes per-product loading detail).\n\n' +
      'Only products with `quantityRemaining > 0` appear in `products` - a ' +
      'product collected in full is not part of a stock balance. The TOTALS ' +
      'still describe the whole order history, so `products` does NOT sum to ' +
      '`totalPurchasedCartons`; a distributor holding nothing gets an empty ' +
      'array with non-zero totals.\n\n' +
      'Each product carries the ERP `itemCode` (ITEM_CODE from the ' +
      'sales-order feed), null where the feed states none.',
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

  @Get('me/invoices')
  @ApiOperation({
    summary: 'Order / invoice history',
    description:
      'Paginated `{ data, meta }`: `page`, `pageSize` (clamped to 200 and ' +
      'echoed back as applied), plus `search` on order id or product name ' +
      'and `startDate` / `endDate` on the order date. `meta.total` counts ' +
      'the rows the current filter matches.\n\n' +
      'Each row carries its `items` - read from the ERP sales-order feed ' +
      'where the projector has not copied them locally.\n\n' +
      'RENAMED: this was GET /customers/me/purchases. The old ' +
      '/customers/me/invoices is now /customers/me/account.',
  })
  @ApiOkResponse({ type: PaginatedPurchasesResponseDto })
  async getPurchases(
    @CurrentUser() user: any,
    @Query() query: PurchaseFilterDto,
  ) {
    return this.customerService.getPurchases(user.id, query, query);
  }

  @Get('me/invoices/:id')
  @ApiOperation({
    summary: 'Order detail with line items + linked invoice',
    description:
      'Tapping any order opens this detail view: individual product lines, ' +
      'status, and the derived invoice number. The invoice number is ' +
      'generated from the order ERP id until the ERP supplies the real ' +
      'link.\n\n' +
      '`lines` is read from the ERP sales-order feed when the projector has ' +
      'not copied lines locally, which is the case for almost every order - ' +
      'it used to come back empty. Each line carries `product`, `itemCode` ' +
      'and `quantity`. `unitPrice` and `amount` are NULL: the ERP feed ' +
      'states no per-line money, only the order total, which is on ' +
      '`totalValue`.\n\n' +
      'RENAMED: this was GET /customers/me/purchases/{id}.',
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

  @Get('me/account')
  @ApiOperation({
    summary: 'Account tab aggregate',
    description:
      'Wallet balance, the invoice list with derived statuses ' +
      '(Paid / Part Paid / Unpaid), and payment history with running ' +
      'balance. Read-only — no Pay-Now action exists.\n\n' +
      'PAGINATED: `page` and `pageSize` apply to BOTH lists. `meta` describes ' +
      '`invoices`; `paymentHistoryMeta` describes `paymentHistory`. The two ' +
      'are different lengths, so one block could not describe both without ' +
      'silently truncating the longer — read whichever you are paging. ' +
      '`pageSize` is clamped to 200 and echoed back as applied.\n\n' +
      'Both lists were previously unbounded: one distributor returned 4,660 ' +
      'invoices and 6,796 payments in a single response.\n\n' +
      'RENAMED: this was GET /customers/me/invoices. That path now serves ' +
      'the order/invoice LIST (formerly /customers/me/purchases).',
  })
  @ApiOkResponse({ type: InvoicesResponseDto })
  async getAccount(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getInvoices(user.id, pagination);
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

  @Get('me/account/:id')
  @ApiOperation({
    summary: 'Invoice detail with line items',
    description:
      'Tapping any invoice on the Account tab opens this detail view: line ' +
      'items, quantities, tax and grand total.\n\n' +
      '`lineItems` is read from the ERP sales-order feed when the projector ' +
      'has not copied lines locally, which is the case for almost every ' +
      'order - it used to come back empty. Each line carries `productName`, ' +
      '`itemCode` and `quantity`. `unitPrice` and `lineTotal` are NULL: the ' +
      'ERP feed states no per-line money, only the order total, which is on ' +
      '`grandTotal`.\n\n' +
      'RENAMED: this was GET /customers/me/invoices/{id}.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  async getInvoiceDetail(
    @CurrentUser() user: any,
    @Param('id') invoiceId: string,
  ) {
    return this.customerService.getInvoiceDetail(user.id, invoiceId);
  }

  // ─── ERP financial ledgers ────────────────────────────────
  // Three ledgers, six routes. Each names its own config at the call site, so
  // the table can never be chosen by a path segment and there is no unknown
  // ledger to 404 on. Every query is scoped to the signed-in distributor by
  // CUSTOMER_CODE - another customer's document reads as not-found, exactly as
  // a nonexistent one does.

  @Get('me/erp/refund')
  @ApiOperation({
    summary: 'ERP AR refunds for this distributor',
    description:
      'Paginated `{ data, meta }`, newest first, read live from ' +
      '`erp_raw.raw_ar_refund` and scoped to the signed-in distributor by ' +
      'CUSTOMER_CODE.\n\n' +
      'Money sits under `amounts`, keyed by name - this ledger carries ' +
      '`refundAmount` among others. Each figure has the ERP\u2019s `fc` and `tc` ' +
      'values, both NULL where it states none. Null means "not stated", not ' +
      'zero.\n\n' +
      'An absent ERP feed or an unknown customer returns an empty page with a ' +
      'valid `meta`, never an error.',
  })
  @ApiOkResponse({ type: PaginatedErpFinancialRecordsResponseDto })
  async getErpRefunds(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getErpFinancialRecords(
      user.id,
      REFUND_RECORD,
      pagination,
    );
  }

  @Get('me/erp/refund/:id')
  @ApiOperation({
    summary: 'One ERP AR refunds document',
    description:
      'The detail behind a row of GET /customers/me/erp/refund, in the same ' +
      'shape.\n\n' +
      'Scoped to the signed-in distributor: a document belonging to another ' +
      'customer answers 404, exactly as an unknown one does, so a document ' +
      'number cannot be probed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ERP document number (DOC_NO).',
    example: '6401-202606100001',
  })
  @ApiOkResponse({ type: ErpFinancialRecordDto })
  @ApiNotFoundResponse({
    description: 'No such document for this distributor',
  })
  async getErpRefund(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.getErpFinancialRecord(
      user.id,
      REFUND_RECORD,
      id,
    );
  }

  @Get('me/erp/collection')
  @ApiOperation({
    summary: 'ERP collections (money received) for this distributor',
    description:
      'Paginated `{ data, meta }`, newest first, read live from ' +
      '`erp_raw.raw_collection` and scoped to the signed-in distributor by ' +
      'CUSTOMER_CODE.\n\n' +
      'Money sits under `amounts`, keyed by name - this ledger carries ' +
      '`collectionAmount` among others. Each figure has the ERP\u2019s `fc` and `tc` ' +
      'values, both NULL where it states none. Null means "not stated", not ' +
      'zero.\n\n' +
      'An absent ERP feed or an unknown customer returns an empty page with a ' +
      'valid `meta`, never an error.',
  })
  @ApiOkResponse({ type: PaginatedErpFinancialRecordsResponseDto })
  async getErpCollections(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getErpFinancialRecords(
      user.id,
      COLLECTION_RECORD,
      pagination,
    );
  }

  @Get('me/erp/collection/:id')
  @ApiOperation({
    summary: 'One ERP collections (money received) document',
    description:
      'The detail behind a row of GET /customers/me/erp/collection, in the same ' +
      'shape.\n\n' +
      'Scoped to the signed-in distributor: a document belonging to another ' +
      'customer answers 404, exactly as an unknown one does, so a document ' +
      'number cannot be probed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ERP document number (DOC_NO).',
    example: '6301-202606080107',
  })
  @ApiOkResponse({ type: ErpFinancialRecordDto })
  @ApiNotFoundResponse({
    description: 'No such document for this distributor',
  })
  async getErpCollection(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.getErpFinancialRecord(
      user.id,
      COLLECTION_RECORD,
      id,
    );
  }

  @Get('me/erp/receivable')
  @ApiOperation({
    summary: 'ERP other receivables for this distributor',
    description:
      'Paginated `{ data, meta }`, newest first, read live from ' +
      '`erp_raw.raw_other_receivable` and scoped to the signed-in distributor by ' +
      'CUSTOMER_CODE.\n\n' +
      'Money sits under `amounts`, keyed by name - this ledger carries ' +
      '`receivableAmount` among others. Each figure has the ERP\u2019s `fc` and `tc` ' +
      'values, both NULL where it states none. Null means "not stated", not ' +
      'zero.\n\n' +
      'An absent ERP feed or an unknown customer returns an empty page with a ' +
      'valid `meta`, never an error.',
  })
  @ApiOkResponse({ type: PaginatedErpFinancialRecordsResponseDto })
  async getErpReceivables(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.customerService.getErpFinancialRecords(
      user.id,
      RECEIVABLE_RECORD,
      pagination,
    );
  }

  @Get('me/erp/receivable/:id')
  @ApiOperation({
    summary: 'One ERP other receivables document',
    description:
      'The detail behind a row of GET /customers/me/erp/receivable, in the same ' +
      'shape.\n\n' +
      'Scoped to the signed-in distributor: a document belonging to another ' +
      'customer answers 404, exactly as an unknown one does, so a document ' +
      'number cannot be probed.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ERP document number (DOC_NO).',
    example: '6201-202004050003',
  })
  @ApiOkResponse({ type: ErpFinancialRecordDto })
  @ApiNotFoundResponse({
    description: 'No such document for this distributor',
  })
  async getErpReceivable(@CurrentUser() user: any, @Param('id') id: string) {
    return this.customerService.getErpFinancialRecord(
      user.id,
      RECEIVABLE_RECORD,
      id,
    );
  }
}
