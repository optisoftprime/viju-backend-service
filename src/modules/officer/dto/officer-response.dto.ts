import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';

const REGION_VALUES = ['LAGOS', 'SOUTH_WEST', 'SOUTH_EAST', 'NORTH'] as const;
type Region = (typeof REGION_VALUES)[number];

const ACCOUNT_STATUS_VALUES = ['ACTIVE', 'ON_HOLD'] as const;
type AccountStatus = (typeof ACCOUNT_STATUS_VALUES)[number];

const ORDER_STATUS_VALUES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;
type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

const LOADING_REQUEST_STATUS_VALUES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'LOADING_IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
type LoadingRequestStatus = (typeof LOADING_REQUEST_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// GET /officers/dashboard  -> OfficerService.getDashboardSummary
// ---------------------------------------------------------------------------
export class OfficerDashboardSummaryDto {
  @ApiProperty({ example: 42, description: 'Total distributors in portfolio' })
  totalDistributors: number;

  @ApiProperty({
    example: 5,
    description: 'Customers with a negative outstanding balance',
  })
  overdueBalances: number;

  @ApiProperty({ example: 3, description: 'OPEN support tickets in portfolio' })
  openTickets: number;

  @ApiProperty({
    example: 7,
    description: 'Unread inbound (CUSTOMER) messages in portfolio',
  })
  unreadMessages: number;
}

// ---------------------------------------------------------------------------
// GET /officers/customers  -> OfficerService.getAssignedCustomers
// ---------------------------------------------------------------------------
export class AssignedCustomerListItemDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Acme Distributors Ltd' })
  name: string;

  @ApiProperty({
    example: 'ERP-001',
    description: 'ERP account number (Customer.erpId)',
  })
  accountNumber: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({
    example: -50000.5,
    description: 'Outstanding balance (Customer.outstandingBalance)',
  })
  walletBalance: number;

  @ApiProperty({ enum: ACCOUNT_STATUS_VALUES, example: 'ACTIVE' })
  accountStatus: AccountStatus;

  @ApiProperty({ example: 2, description: 'Count of OPEN support tickets' })
  openTickets: number;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
    description: 'Most recent purchase order date, or null if none',
  })
  lastPurchaseDate: Date | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    description:
      'Most recent message date; falls back to customer.updatedAt when no messages exist',
  })
  lastContactDate: Date;
}

export class PaginatedAssignedCustomersResponseDto {
  @ApiProperty({ type: [AssignedCustomerListItemDto] })
  data: AssignedCustomerListItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/overview  -> OfficerService.getCustomerOverview
// ---------------------------------------------------------------------------
export class AssignedOfficerDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'john@example.com' })
  email: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({
    example: true,
    description: 'Whether this officer is the primary assignment',
  })
  isPrimary: boolean;
}

export class CustomerOverviewDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Acme Distributors Ltd' })
  name: string;

  @ApiProperty({ example: 'ERP-001', description: 'ERP account number' })
  accountNumber: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({
    example: 'contact@acme.com',
    nullable: true,
    description: 'Customer email (Customer.email is optional)',
  })
  email: string | null;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ enum: ACCOUNT_STATUS_VALUES, example: 'ACTIVE' })
  accountStatus: AccountStatus;

  @ApiProperty({
    example: -50000.5,
    description: 'Outstanding balance (Customer.outstandingBalance)',
  })
  walletBalance: number;

  @ApiProperty({ type: [AssignedOfficerDto] })
  assignedOfficers: AssignedOfficerDto[];

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  lastUpdated: Date;
}

// ---------------------------------------------------------------------------
// Shared Purchase / PurchaseItem shapes (include: { items: true })
// ---------------------------------------------------------------------------
export class PurchaseItemDto {
  @ApiProperty({ example: 'item-uuid-1' })
  id: string;

  @ApiProperty({ example: 'purchase-uuid-1' })
  purchaseId: string;

  @ApiProperty({ example: 'Premium Cooking Oil 5L' })
  productName: string;

  @ApiProperty({ example: 10 })
  quantity: number;

  @ApiProperty({ example: 4500.0 })
  unitPrice: number;

  @ApiProperty({ example: 45000.0 })
  lineTotal: number;
}

export class PurchaseDto {
  @ApiProperty({ example: 'purchase-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-ORD-001' })
  erpId: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({ example: 3 })
  totalItems: number;

  @ApiProperty({ example: 135000.0 })
  totalValue: number;

  @ApiProperty({ enum: ORDER_STATUS_VALUES, example: 'DELIVERED' })
  status: OrderStatus;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: [PurchaseItemDto] })
  items: PurchaseItemDto[];
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/orders  -> OfficerService.getCustomerOrders
// ---------------------------------------------------------------------------
export class PaginatedCustomerOrdersResponseDto {
  @ApiProperty({ type: [PurchaseDto] })
  data: PurchaseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/invoices -> OfficerService.getCustomerInvoices
// ---------------------------------------------------------------------------
export class PaymentDto {
  @ApiProperty({ example: 'payment-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'ERP-PAY-001',
    nullable: true,
    description: 'ERP payment id (Payment.erpId is optional)',
  })
  erpId: string | null;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 25000.0 })
  amount: number;

  @ApiProperty({
    example: 'TRX-REF-1234',
    nullable: true,
    description: 'Payment reference (optional)',
  })
  reference: string | null;

  @ApiProperty({ example: -25000.0 })
  runningBalance: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

export class CustomerInvoicesDto {
  @ApiProperty({
    example: -50000.5,
    description: 'Outstanding balance, defaults to 0 if customer not found',
  })
  walletBalance: number;

  @ApiProperty({ type: [PurchaseDto] })
  invoices: PurchaseDto[];

  @ApiProperty({ type: [PaymentDto] })
  paymentHistory: PaymentDto[];
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/stock  -> OfficerService.getCustomerStock
// ---------------------------------------------------------------------------
export class StockItemDto {
  @ApiProperty({ example: 'stock-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-STK-001' })
  erpId: string;

  @ApiProperty({ example: 'Premium Cooking Oil 5L' })
  productName: string;

  @ApiProperty({ example: 1200 })
  quantity: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

export class AwaitingLoadingItemDto {
  @ApiProperty({ example: 'Premium Cooking Oil 5L' })
  productName: string;

  @ApiProperty({
    example: 50,
    description: 'Total quantity reserved across the customer purchases',
  })
  reserved: number;

  @ApiProperty({
    example: 20,
    description: 'Quantity already loaded (from COMPLETED loading requests)',
  })
  loaded: number;

  @ApiProperty({
    example: 30,
    description: 'max(0, reserved - loaded): cartons still awaiting loading',
  })
  remaining: number;
}

export class CustomerStockDto {
  @ApiProperty({
    type: [StockItemDto],
    description: 'Full ERP stock catalogue (prisma.stock.findMany)',
  })
  catalogue: StockItemDto[];

  @ApiProperty({ type: [AwaitingLoadingItemDto] })
  awaitingLoading: AwaitingLoadingItemDto[];
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/waybills -> OfficerService.getCustomerWaybills
// ---------------------------------------------------------------------------
export class WaybillAssignedOfficerDto {
  @ApiProperty({ example: 'officer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;
}

export class WaybillLinkedPurchaseDto {
  @ApiProperty({ example: 'ERP-ORD-001' })
  erpId: string;
}

export class LoadingRequestDto {
  @ApiProperty({ example: 'loading-request-uuid-1' })
  id: string;

  @ApiProperty({ example: 'LR-2026-0001' })
  reference: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({
    example: 'purchase-uuid-1',
    nullable: true,
    description: 'Linked purchase id (optional)',
  })
  linkedPurchaseId: string | null;

  @ApiProperty({ example: 'LAG-123-XY' })
  truckPlateNumber: string;

  @ApiProperty({ example: 'Musa Bello' })
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  driverPhone: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  requestedLoadingDate: Date;

  @ApiProperty({
    example: 100,
    nullable: true,
    description: 'Quantity in cartons (optional)',
  })
  quantityCartons: number | null;

  @ApiProperty({
    example: 'Ikeja Warehouse',
    nullable: true,
    description: 'Destination (optional)',
  })
  destination: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  termsAcceptedAt: Date;

  @ApiProperty({
    example: 'https://forms.example.com/lr/abc',
    nullable: true,
    description: 'External form URL (optional)',
  })
  externalFormUrl: string | null;

  @ApiProperty({
    enum: LOADING_REQUEST_STATUS_VALUES,
    example: 'PENDING_ASSIGNMENT',
  })
  status: LoadingRequestStatus;

  @ApiProperty({
    example: 'officer-uuid-1',
    nullable: true,
    description: 'Assigned loading officer id (optional)',
  })
  assignedOfficerId: string | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  assignedAt: Date | null;

  @ApiProperty({
    example: 'admin-uuid-1',
    nullable: true,
    description: 'Id of staff who made the assignment (optional)',
  })
  assignedById: string | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  loadingStartedAt: Date | null;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  completedAt: Date | null;

  @ApiProperty({
    example: 'https://docs.example.com/waybill/abc.pdf',
    nullable: true,
    description: 'Waybill document URL (optional)',
  })
  waybillDocumentUrl: string | null;

  @ApiProperty({
    example: 'Handle with care',
    nullable: true,
    description: 'Free-text notes (optional)',
  })
  notes: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({
    type: WaybillAssignedOfficerDto,
    nullable: true,
    description: 'Assigned officer (id + name), null when unassigned',
  })
  assignedOfficer: WaybillAssignedOfficerDto | null;

  @ApiProperty({
    type: WaybillLinkedPurchaseDto,
    nullable: true,
    description: 'Linked purchase (erpId only), null when not linked',
  })
  linkedPurchase: WaybillLinkedPurchaseDto | null;
}

export class PaginatedCustomerWaybillsResponseDto {
  @ApiProperty({ type: [LoadingRequestDto] })
  data: LoadingRequestDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ---------------------------------------------------------------------------
// GET /officers/stock  -> OfficerService.getStock
// ---------------------------------------------------------------------------
export class PaginatedStockResponseDto {
  @ApiProperty({ type: [StockItemDto] })
  data: StockItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id  (legacy aggregate) -> getCustomerDetail
//
// SECURITY NOTE: the service spreads the raw Customer record (`{ ...customer }`),
// which includes sensitive auth fields (password hash, failedLoginAttempts,
// lockedUntil). This DTO documents ONLY client-intended fields and deliberately
// omits those secrets. See the agent report for the flagged discrepancy.
// ---------------------------------------------------------------------------
export class SupportTicketDto {
  @ApiProperty({ example: 'ticket-uuid-1' })
  id: string;

  @ApiProperty({ example: 'TKT-2026-0001' })
  ticketId: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({
    enum: ['ACCOUNT_QUERY', 'DELIVERY_ISSUE', 'PRODUCT_QUERY', 'OTHER'],
    example: 'DELIVERY_ISSUE',
  })
  category: 'ACCOUNT_QUERY' | 'DELIVERY_ISSUE' | 'PRODUCT_QUERY' | 'OTHER';

  @ApiProperty({ example: 'Delivery delayed' })
  subject: string;

  @ApiProperty({ example: 'My order has not arrived after 5 days.' })
  description: string;

  @ApiProperty({
    example: 'https://docs.example.com/attach/abc.png',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({
    enum: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'],
    example: 'OPEN',
  })
  status: 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED';

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

export class CustomerDetailDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-001' })
  erpId: string;

  @ApiProperty({ example: 'Acme Distributors Ltd' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'contact@acme.com', nullable: true })
  email: string | null;

  @ApiProperty({
    example: 'https://docs.example.com/photo/abc.jpg',
    nullable: true,
  })
  profilePhotoUrl: string | null;

  @ApiProperty({ enum: ACCOUNT_STATUS_VALUES, example: 'ACTIVE' })
  accountStatus: AccountStatus;

  @ApiProperty({ example: -50000.5 })
  outstandingBalance: number;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ example: 'officer-uuid-1', nullable: true })
  assignedOfficerId: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: [PurchaseDto] })
  purchases: PurchaseDto[];

  @ApiProperty({ type: [PaymentDto] })
  payments: PaymentDto[];

  @ApiProperty({ type: [SupportTicketDto] })
  supportTickets: SupportTicketDto[];
}
