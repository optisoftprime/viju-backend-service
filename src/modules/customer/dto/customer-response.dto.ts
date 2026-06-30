import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';

const REGION_VALUES = ['LAGOS', 'SOUTH_WEST', 'SOUTH_EAST', 'NORTH'] as const;
type Region = (typeof REGION_VALUES)[number];

const ORDER_STATUS_VALUES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

const INVOICE_STATUS_VALUES = ['PAID', 'PART_PAID', 'UNPAID'] as const;
type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

// ─── Shared line item ──────────────────────────────────────

export class PurchaseItemDto {
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
  @ApiProperty({ example: 120 })
  totalRemainingCartons: number;

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

  @ApiProperty({ example: 'https://cdn.viju.example/photos/me.jpg', nullable: true })
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

  @ApiProperty({ type: [PurchaseItemDto] })
  items: PurchaseItemDto[];
}

export class PaginatedPurchasesResponseDto {
  @ApiProperty({ type: [PurchaseListItemDto] })
  data: PurchaseListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Purchase detail (GET /customers/me/purchases/:id) ─────

export class PurchaseDetailDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'VJ-2026-675', description: 'Order ERP id' })
  orderId: string;

  @ApiProperty({ example: '2026-06-01T10:00:00.000Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({ enum: ORDER_STATUS_VALUES, example: 'DELIVERED' })
  status: OrderStatus;

  @ApiProperty({ example: 3 })
  totalItems: number;

  @ApiProperty({ example: 45000.0 })
  totalValue: number;

  @ApiProperty({ example: 'INV-444120', description: 'Derived invoice number' })
  linkedInvoiceNumber: string;

  @ApiProperty({ type: [PurchaseItemDto] })
  items: PurchaseItemDto[];
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

  @ApiProperty({ type: [PurchaseItemDto] })
  lineItems: PurchaseItemDto[];

  @ApiProperty({ example: 45000.0 })
  subtotal: number;

  @ApiProperty({ example: 0, description: 'Tax (currently always 0)' })
  tax: number;

  @ApiProperty({ example: 45000.0 })
  grandTotal: number;
}
