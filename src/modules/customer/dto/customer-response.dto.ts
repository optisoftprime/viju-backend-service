import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

/**
 * B-5.3 — the order lifecycle the ERP mapping produces. SHIPPED is legacy
 * data only; new syncs use DISPATCHED.
 */
const ORDER_STATUS_VALUES = [
  'PENDING',
  'PROCESSING',
  'LOADED',
  'DISPATCHED',
  'DELIVERED',
  'CLOSED',
  'CANCELLED',
  'SHIPPED',
] as const;
type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

const INVOICE_STATUS_VALUES = ['PAID', 'PART_PAID', 'UNPAID'] as const;
type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

// ─── Shared line item ──────────────────────────────────────

export class CustomerPurchaseItemDto {
  @ApiProperty({ example: 'item-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Viju Chivita 1L' })
  productName: string;

  @ApiProperty({ example: 10 })
  quantity: number;

  @ApiProperty({ example: 1500.0 })
  unitPrice: number;

  @ApiProperty({ example: 15000.0 })
  lineTotal: number;
}

// ─── Home aggregate (GET /customers/me/home) ───────────────

export class HomeAccountBalanceDto {
  @ApiProperty({ example: 50000.5 })
  amount: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  lastUpdated: Date;

  @ApiProperty({ example: false, description: 'True when balance is negative' })
  isLow: boolean;
}

export class HomeStockBalanceDto {
  @ApiProperty({
    example: 700,
    description: 'Total cartons paid for (the "of 700" in "280 of 700")',
  })
  totalCartons: number;

  @ApiProperty({
    example: 280,
    description: 'Cartons already loaded/collected (progress = loaded / total)',
  })
  loadedCartons: number;

  @ApiProperty({
    example: 420,
    description:
      'Cartons paid for but not yet loaded (total - loaded), from the ERP ' +
      'sales-order feed: SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY). This is ' +
      'the SAME figure GET /customers/me/stock-balance returns as ' +
      '`totalRemainingCartons` - the two share one calculation and cannot ' +
      'disagree. Falls back to the locally projected purchases only where the ' +
      'ERP feed is absent or holds no orders for the customer.',
  })
  remainingCartons: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  lastUpdated: Date;
}

export class HomeProductFlyerDto {
  @ApiProperty({ example: 'flyer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'https://cdn.viju.example/flyers/chivita.jpg' })
  imageUrl: string;

  @ApiProperty({ example: 'New Viju Chivita 1L' })
  name: string;

  @ApiProperty({
    example:
      'Buy 50 cartons of Viju Milk between 1-31 December and get 5 free.',
    nullable: true,
    description:
      'F-1 - the promotion copy, as readable text rather than baked into the ' +
      'artwork. Null when the admin left it blank.',
  })
  description: string | null;
}

export class HomeRecentPurchaseDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-2026-675' })
  erpId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({ example: 3 })
  totalItems: number;

  @ApiProperty({ example: 45000.0 })
  totalValue: number;

  @ApiProperty({ enum: ORDER_STATUS_VALUES, example: 'DELIVERED' })
  status: OrderStatus;
}

export class HomeResponseDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Customer / enterprise name, for the home screen greeting',
  })
  customerName: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/dx87iv1qi/image/upload/v.../photo.jpg',
    nullable: true,
    description: 'Customer profile photo URL (null if none set)',
  })
  profilePhotoUrl: string | null;

  @ApiProperty({ type: HomeAccountBalanceDto })
  accountBalance: HomeAccountBalanceDto;

  @ApiProperty({ type: HomeStockBalanceDto })
  stockBalance: HomeStockBalanceDto;

  @ApiProperty({
    example: 1000.1111,
    description:
      'Temporary (supplementary) credit in force TODAY, summed across every ' +
      'ERP credit grant whose EFFECTIVE_DATE..INEFFECTIVE_DATE window contains ' +
      'today (CREDIT_AMT1). 0 when no grant is currently active, when every ' +
      'window has expired, or when the ERP credit feed is unavailable. ' +
      'Full precision, never rounded.',
  })
  temporarilyCredit: number;

  @ApiProperty({ type: [HomeProductFlyerDto] })
  productFlyers: HomeProductFlyerDto[];

  @ApiProperty({ type: [HomeRecentPurchaseDto] })
  recentPurchases: HomeRecentPurchaseDto[];
}

// ─── ERP waybills (GET /customers/me/erp/waybills) ────────

/**
 * One goods-movement document as the ERP holds it.
 *
 * Distinct from GET /customers/me/waybills, which lists the loading requests
 * raised through this app. This is the ERP's own record, whether or not it
 * ever passed through the portal.
 */
export class ErpWaybillDto {
  @ApiProperty({
    example: '2300-202503070060',
    description: 'The ERP document number (DOC_NO). Identifies the record.',
  })
  docNo: string;

  @ApiProperty({ example: '2025-03-07 00:00:00', nullable: true })
  docDate: string | null;

  @ApiProperty({
    example: '2025-03-07 00:00:00',
    nullable: true,
    description: 'Rows are sorted on this, newest first (docDate as fallback).',
  })
  orderDate: string | null;

  @ApiProperty({
    example: 'Lagos Depot',
    nullable: true,
    description: 'Ship-to address name as the ERP records it.',
  })
  shipTo: string | null;

  @ApiProperty({
    example: 2,
    description:
      'How many ERP line rows this document collapsed. `raw_sales_order` is ' +
      'one row per line; the list is one row per document.',
  })
  lines: number;

  @ApiProperty({
    example: 1,
    description: 'Distinct products on the document.',
  })
  products: number;

  @ApiProperty({
    example: 3640,
    description: 'Cartons ordered (BUSINESS_QTY).',
  })
  quantityOrdered: number;

  @ApiProperty({
    example: 3500,
    description: 'Cartons delivered (DELIVERED_BUSINESS_QTY).',
  })
  quantityDelivered: number;

  @ApiProperty({
    example: 140,
    description: 'Ordered minus delivered, floored at 0.',
  })
  quantityRemaining: number;

  @ApiProperty({
    enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'CLOSED'],
    example: 'PROCESSING',
    description:
      'Derived with the same precedence the order reconciler uses, so a ' +
      'document cannot read one status here and another on the order list.',
  })
  status: string;

  @ApiProperty({
    example: '2026-08-28T12:49:31.019Z',
    format: 'date-time',
    nullable: true,
    description: 'When the ERP last changed any line of this document.',
  })
  lastChangedAt: Date | null;
}

export class PaginatedErpWaybillsResponseDto {
  @ApiProperty({ type: [ErpWaybillDto] })
  data: ErpWaybillDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Officer chat list (GET /customers/me/chats) ──────────

/**
 * One account officer the distributor can message.
 *
 * The mirror of a row on GET /officers/chats, naming the officer so a
 * distributor can tell their officers apart and pick who to write to.
 */
export class CustomerOfficerChatItemDto {
  @ApiProperty({
    example: '7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44',
    description:
      'The officer to open a thread with: pass this as `{otherUserId}` to ' +
      'GET /chat/{otherUserId} and as `{receiverId}` to POST /chat/{receiverId}.',
  })
  officerId: string;

  @ApiProperty({
    example: 'Ifeanyi Okon',
    description:
      "The officer's real name. Shown to the distributor so they can tell " +
      'their officers apart.',
  })
  name: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/viju/staff/ifeanyi.jpg',
    nullable: true,
    description: 'Officer profile picture; null when they have not set one.',
  })
  avatarUrl: string | null;

  @ApiProperty({
    example: true,
    description:
      'The primary officer - the one a message sent through POST /chat/me is ' +
      'routed to. Exactly one row carries true.',
  })
  isPrimary: boolean;

  @ApiProperty({
    example: 'Your waybill is ready for collection.',
    nullable: true,
    description:
      'Excerpt of the newest message on THIS officer’s thread, either side. ' +
      '120 characters, whitespace collapsed, "📎 Attachment" for an ' +
      'attachment-only message. Null when they have never exchanged a message.',
  })
  lastMessagePreview: string | null;

  @ApiProperty({
    enum: ['CUSTOMER', 'STAFF'],
    nullable: true,
    example: 'STAFF',
    description: 'Who wrote it — prefix "You: " when this is CUSTOMER.',
  })
  lastMessageSenderType: 'CUSTOMER' | 'STAFF' | null;

  @ApiProperty({
    example: '2026-08-28T08:12:00.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'When the newest message on this thread arrived. Rows are sorted on ' +
      'this, newest first; an officer never messaged sorts last.',
  })
  lastMessageAt: Date | null;

  @ApiProperty({
    example: 2,
    description:
      'Messages THIS OFFICER sent that the distributor has not read yet - the ' +
      'mirror of `unreadMessages` on GET /officers/chats. Cleared by ' +
      'PATCH /chat/me/read. Always a number, 0 rather than omitted.',
  })
  unreadMessages: number;
}

// ─── Stock balance breakdown (GET /customers/me/stock-balance) ─

export class StockBalanceProductDto {
  @ApiProperty({ example: 'Viju Chivita 1L' })
  productName: string;

  @ApiProperty({ example: 100 })
  quantityPaid: number;

  @ApiProperty({ example: 60 })
  quantityLoaded: number;

  @ApiProperty({
    example: 40,
    description:
      'Ordered minus delivered for this product, floored at 0 so a rare ' +
      'over-delivered line cannot show a negative quantity.',
  })
  quantityRemaining: number;
}

export class StockBalanceBreakdownDto {
  @ApiProperty({
    example: 700,
    description:
      'Total cartons paid for across all products (the "Purchased" figure)',
  })
  totalPurchasedCartons: number;

  @ApiProperty({
    example: 280,
    description: 'Total cartons already loaded/collected across all products',
  })
  totalLoadedCartons: number;

  @ApiProperty({
    example: 420,
    description:
      'Total cartons paid for but not yet loaded (purchased - loaded), from ' +
      'the ERP sales-order feed: SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY). ' +
      'Identical to `stockBalance.remainingCartons` on ' +
      'GET /customers/me/home - one shared calculation. The `products` rows ' +
      'sum to exactly this total.',
  })
  totalRemainingCartons: number;

  @ApiProperty({
    example: 40,
    description:
      'Loading progress as a whole percentage (loaded / purchased * 100)',
  })
  loadingProgress: number;

  @ApiProperty({ type: [StockBalanceProductDto] })
  products: StockBalanceProductDto[];
}

// ─── Profile (GET /customers/me) ───────────────────────────

export class AccountOfficerDto {
  @ApiProperty({
    example: '7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44',
    description:
      'The officer’s id — pass it to GET /chat/{officerId} to open their ' +
      'thread. Matches an `officerId` from GET /customers/me/chats.',
  })
  id: string;

  @ApiProperty({
    example: 'Ifeanyi Okon',
    description:
      'The PRIMARY officer’s real name. This used to be the fixed label ' +
      '"Viju Account Officer"; distributors now see who their officer is. ' +
      'The field name is unchanged so existing clients keep binding to it. ' +
      'For the full list of assigned officers use GET /customers/me/chats.',
  })
  displayName: string;
}

export class CustomerProfileDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-001' })
  erpId: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'acme@example.com', nullable: true })
  email: string | null;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ enum: ['ACTIVE', 'ON_HOLD'], example: 'ACTIVE' })
  accountStatus: 'ACTIVE' | 'ON_HOLD';

  @ApiProperty({ example: 50000.5 })
  outstandingBalance: number;

  @ApiProperty({
    example: 'https://cdn.viju.example/photos/me.jpg',
    nullable: true,
  })
  profilePhotoUrl: string | null;

  @ApiProperty({ type: AccountOfficerDto, nullable: true })
  accountOfficer: AccountOfficerDto | null;
}

// ─── Purchases (GET /customers/me/purchases) ───────────────

export class PurchaseListItemDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-2026-675' })
  erpId: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({ example: 3 })
  totalItems: number;

  @ApiProperty({ example: 45000.0 })
  totalValue: number;

  @ApiProperty({ enum: ORDER_STATUS_VALUES, example: 'DELIVERED' })
  status: OrderStatus;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: [CustomerPurchaseItemDto] })
  items: CustomerPurchaseItemDto[];
}

export class PaginatedPurchasesResponseDto {
  @ApiProperty({ type: [PurchaseListItemDto] })
  data: PurchaseListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Account statement (GET /customers/me/statement) — B-5.1/5.2/5.5 ──────

const STATEMENT_LINE_TYPE_VALUES = [
  'INVOICE',
  'PAYMENT',
  'TRANSPORT_ALLOWANCE',
] as const;

const STATEMENT_PERIOD_VALUES = [
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_6_MONTHS',
  'YEAR_TO_DATE',
  'CUSTOM',
] as const;

export class StatementLineDto {
  @ApiProperty({ example: '2026-07-14T00:00:00.000Z', format: 'date-time' })
  date: Date;

  @ApiProperty({
    enum: STATEMENT_LINE_TYPE_VALUES,
    example: 'PAYMENT',
    description:
      'B-5.1 — the three movement types kept distinct. TRANSPORT_ALLOWANCE is ' +
      'a payment that settles a delivery allowance, not an ordinary payment.',
  })
  type: (typeof STATEMENT_LINE_TYPE_VALUES)[number];

  @ApiProperty({ example: 'VJ-2026-675' })
  reference: string;

  @ApiProperty({ example: 'Payment received' })
  description: string;

  @ApiProperty({
    example: 0,
    description: 'Amount owed by this movement. Always a number, never null.',
  })
  debit: number;

  @ApiProperty({
    example: 250000,
    description: 'Amount credited. Always a number, never null.',
  })
  credit: number;

  @ApiProperty({
    example: 1240000,
    description:
      'B-5.5 — balance after this line, computed server-side in chronological ' +
      'order. Do not recompute on the client.',
  })
  runningBalance: number;
}

export class StatementResponseDto {
  @ApiProperty({
    example: 'Ade Foods Ltd',
    description: 'B-5.1 — replaces distributorName.',
  })
  customerName: string;

  @ApiProperty({
    example: 'VJ-00987',
    description: 'B-5.1 — replaces erpId.',
  })
  code: string;

  @ApiProperty({ enum: STATEMENT_PERIOD_VALUES, example: 'LAST_30_DAYS' })
  period: (typeof STATEMENT_PERIOD_VALUES)[number];

  @ApiProperty({ example: '2026-07-21T00:00:00.000Z', format: 'date-time' })
  startDate: Date;

  @ApiProperty({ example: '2026-08-20T00:00:00.000Z', format: 'date-time' })
  endDate: Date;

  @ApiProperty({
    example: 990000,
    description: 'Balance carried into the window from everything before it.',
  })
  openingBalance: number;

  @ApiProperty({
    example: 1240000,
    description: 'openingBalance + Σ(credit) − Σ(debit) across the window.',
  })
  closingBalance: number;

  @ApiProperty({ example: 310000 })
  totalDebit: number;

  @ApiProperty({ example: 560000 })
  totalCredit: number;

  @ApiProperty({ type: [StatementLineDto] })
  lines: StatementLineDto[];
}

// ─── Order/payment detail lines — B-5.4 ──────────────────────────────────

export class TransactionLineDto {
  @ApiProperty({ example: 'Viju Milk 330ml' })
  product: string;

  @ApiProperty({
    example: 'ITM-0099',
    nullable: true,
    description: 'ERP item code. Null until the ERP projection supplies it.',
  })
  itemCode: string | null;

  @ApiProperty({ example: 120 })
  quantity: number;

  @ApiProperty({ example: 2500 })
  unitPrice: number;

  @ApiProperty({ example: 300000, description: 'Line total' })
  amount: number;

  @ApiProperty({
    example: 1240000,
    description:
      'Running account balance at this transaction, from the same ledger the ' +
      'statement uses.',
  })
  accountBalance: number;
}

// ─── Purchase detail (GET /customers/me/purchases/:id) ─────

export class PurchaseDetailDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-2026-675', description: 'Order ERP id' })
  orderId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({
    enum: ORDER_STATUS_VALUES,
    example: 'CLOSED',
    description:
      'B-5.3 — mapped from the ERP order state through the published table, ' +
      'not defaulted to PROCESSING. An unmappable ERP state becomes PENDING.',
  })
  status: OrderStatus;

  @ApiProperty({
    example: '2026-06-04T09:12:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'When the status last changed. Null for never-synced rows.',
  })
  statusUpdatedAt: Date | null;

  @ApiProperty({ example: 3 })
  totalItems: number;

  @ApiProperty({ example: 45000.0 })
  totalValue: number;

  @ApiProperty({ example: 'INV-444120', description: 'Derived invoice number' })
  linkedInvoiceNumber: string;

  @ApiProperty({
    example: 1240000,
    description: 'Running account balance at this transaction (B-5.4).',
  })
  accountBalance: number;

  @ApiProperty({
    type: [TransactionLineDto],
    description:
      'B-5.4 — the six columns the detail screen renders. Empty array (never ' +
      'null) when the ERP supplied no lines.',
  })
  lines: TransactionLineDto[];

  @ApiProperty({
    type: [CustomerPurchaseItemDto],
    deprecated: true,
    description: 'Superseded by `lines`; kept for the existing screens.',
  })
  items: CustomerPurchaseItemDto[];
}

// ─── Payments (GET /customers/me/payments) ─────────────────

export class PaymentListItemDto {
  @ApiProperty({ example: 'payment-uuid-1' })
  id: string;

  @ApiProperty({ example: 'PAY-001', nullable: true })
  erpId: string | null;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 25000.0 })
  amount: number;

  @ApiProperty({ example: 'TRX-REF-9921', nullable: true })
  reference: string | null;

  @ApiProperty({ example: 50000.5 })
  runningBalance: number;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  createdAt: Date;
}

export class PaginatedPaymentsResponseDto {
  @ApiProperty({ type: [PaymentListItemDto] })
  data: PaymentListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Invoices aggregate (GET /customers/me/invoices) ───────

export class WalletBalanceDto {
  @ApiProperty({ example: 50000.5 })
  amount: number;

  @ApiProperty({ example: false })
  isOverdue: boolean;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  lastUpdated: Date;
}

export class InvoiceSummaryDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'INV-444120' })
  invoiceNumber: string;

  @ApiProperty({ example: 'VJ-2026-675' })
  orderId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 45000.0 })
  totalAmount: number;

  @ApiProperty({ enum: INVOICE_STATUS_VALUES, example: 'PAID' })
  status: InvoiceStatus;
}

export class PaymentHistoryItemDto {
  @ApiProperty({ example: 'payment-uuid-1' })
  id: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 25000.0 })
  amount: number;

  @ApiProperty({ example: 'TRX-REF-9921', nullable: true })
  reference: string | null;

  @ApiProperty({ example: 50000.5 })
  runningBalance: number;
}

export class InvoicesResponseDto {
  @ApiProperty({ type: WalletBalanceDto })
  walletBalance: WalletBalanceDto;

  @ApiProperty({
    example: 'To make a payment, contact your Viju Account Officer.',
  })
  contactNote: string;

  @ApiProperty({ type: [InvoiceSummaryDto] })
  invoices: InvoiceSummaryDto[];

  @ApiProperty({ type: [PaymentHistoryItemDto] })
  paymentHistory: PaymentHistoryItemDto[];
}

// ─── Invoice detail (GET /customers/me/invoices/:id) ───────

export class InvoiceDetailDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'INV-444120' })
  invoiceNumber: string;

  @ApiProperty({ example: 'VJ-2026-675' })
  orderId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ enum: INVOICE_STATUS_VALUES, example: 'PAID' })
  status: InvoiceStatus;

  @ApiProperty({ type: [CustomerPurchaseItemDto] })
  lineItems: CustomerPurchaseItemDto[];

  @ApiProperty({ example: 45000.0 })
  subtotal: number;

  @ApiProperty({ example: 0, description: 'Tax (currently always 0)' })
  tax: number;

  @ApiProperty({ example: 45000.0 })
  grandTotal: number;
}
