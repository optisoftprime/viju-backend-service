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
    description: 'Cartons paid for but not yet loaded (total - loaded)',
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

  @ApiProperty({ type: [HomeProductFlyerDto] })
  productFlyers: HomeProductFlyerDto[];

  @ApiProperty({ type: [HomeRecentPurchaseDto] })
  recentPurchases: HomeRecentPurchaseDto[];
}

// ─── Stock balance breakdown (GET /customers/me/stock-balance) ─

export class StockBalanceProductDto {
  @ApiProperty({ example: 'Viju Chivita 1L' })
  productName: string;

  @ApiProperty({ example: 100 })
  quantityPaid: number;

  @ApiProperty({ example: 60 })
  quantityLoaded: number;

  @ApiProperty({ example: 40 })
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
      'Total cartons paid for but not yet loaded (purchased - loaded)',
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
    example: 'Viju Account Officer',
    description: 'Generic label — customers never see the officer’s real name',
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
