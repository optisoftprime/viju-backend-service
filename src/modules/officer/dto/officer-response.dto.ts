import { ApiProperty } from '@nestjs/swagger';
import {
  ErpWaybillDto,
  ErpWaybillDetailDto,
} from '../../customer/dto/customer-response.dto';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

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
    description:
      'Outstanding balance (Customer.outstandingBalance). AO-D1: a ' +
      'full-precision JSON number, never rounded and never a preformatted ' +
      'string.',
  })
  walletBalance: number;

  @ApiProperty({
    example: 39765,
    description:
      'Cartons ordered on the distributor`s OPEN, APPROVED orders - the same ' +
      'figure GET /customers/me/stock-balance calls ' +
      '`totalPurchasedCartons`.',
  })
  totalStock: number;

  @ApiProperty({
    example: 33913,
    description:
      'Cartons already delivered against them - `totalLoadedCartons` on ' +
      'GET /customers/me/stock-balance.',
  })
  stockLoaded: number;

  @ApiProperty({
    example: 5852,
    description:
      'Cartons still to collect: `totalStock` - `stockLoaded`, floored at ' +
      'zero. Identical to `totalRemainingCartons` on ' +
      'GET /customers/me/stock-balance for the same distributor, because ' +
      'it is the same ERP query: SUM(BUSINESS_QTY1 - ' +
      'DELIVERED_BUSINESS_QTY) WHERE CLOSE = `0` AND ApproveStatus = `Y`.',
  })
  stockBalanceCartons: number;

  @ApiProperty({ enum: ACCOUNT_STATUS_VALUES, example: 'ACTIVE' })
  accountStatus: AccountStatus;

  @ApiProperty({ example: 2, description: 'Count of OPEN support tickets' })
  openTickets: number;

  @ApiProperty({
    example: 3,
    description:
      'AO-C1 - unread messages this distributor sent, i.e. how many are ' +
      'waiting on the officer. Always present; 0 when nothing is waiting. ' +
      'Summed across the portfolio this equals `unreadMessages` on ' +
      'GET /officers/dashboard.',
  })
  unreadMessages: number;

  @ApiProperty({
    example: '2026-08-22T07:41:00.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'AO-C1 - most recent message on this thread from either side, or null ' +
      'when the thread is empty. Unlike `lastContactDate` it does NOT fall ' +
      'back to customer.updatedAt, so sorting on it ascending surfaces the ' +
      'distributor who has been waiting longest.',
  })
  lastMessageAt: Date | null;

  @ApiProperty({
    example: 'Has my waybill been assigned?',
    nullable: true,
    description:
      'CH-1 — a one-line excerpt of the most recent message on the thread, ' +
      'either side. Plain text, whitespace collapsed, truncated to 120 ' +
      'characters with an ellipsis. `null` on an empty thread. An ' +
      'attachment-only message previews as "📎 Attachment" rather than an ' +
      'empty string.',
  })
  lastMessagePreview: string | null;

  @ApiProperty({
    enum: ['CUSTOMER', 'STAFF'],
    nullable: true,
    example: 'CUSTOMER',
    description:
      'CH-1 — who wrote the previewed message, so the row can prefix the ' +
      'officer’s own last message with "You: ". `null` on an empty thread.',
  })
  lastMessageSenderType: 'CUSTOMER' | 'STAFF' | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/…/avatars/adlak.jpg',
    nullable: true,
    description:
      'CH-2 — the distributor’s own profile picture, which they set in the ' +
      'mobile app (PATCH /customers/me/photo). `null` when they have not set ' +
      'one — keep drawing initials in that case.',
  })
  avatarUrl: string | null;

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
// GET /officers/chats  ->  OfficerService.getChats      (CH-3)
// ---------------------------------------------------------------------------

/**
 * CH-3 — one conversation, at the shape a WhatsApp-style row renders.
 *
 * Deliberately narrower than AssignedCustomerListItemDto: no wallet balance,
 * no stock figure, no ticket count. A conversation list does not render them,
 * and deriving them cost an ERP credit lookup per page.
 */
export class OfficerChatListItemDto {
  @ApiProperty({
    example: 'bd5d1f0e-3c44-4a91-8f22-71c0a9d6e455',
    description:
      'The distributor. Pass this to GET /chat/{otherUserId} to open the ' +
      'thread — which is also what marks it read.',
  })
  customerId: string;

  @ApiProperty({ example: 'ADLAK' })
  name: string;

  @ApiProperty({
    example: '10110003',
    description:
      'The ERP account code. Still returned — it is what tells two ' +
      'similarly-named distributors apart.',
  })
  accountNumber: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'CH-2 — the distributor’s profile picture, or null. Draw initials when ' +
      'null.',
  })
  avatarUrl: string | null;

  @ApiProperty({
    example: 'Has my waybill been assigned?',
    nullable: true,
    description:
      'CH-1 — excerpt of the newest message, either side. 120 characters, ' +
      'whitespace collapsed, "📎 Attachment" for an attachment-only message.',
  })
  lastMessagePreview: string | null;

  @ApiProperty({
    enum: ['CUSTOMER', 'STAFF'],
    nullable: true,
    example: 'CUSTOMER',
    description: 'Who wrote it — prefix "You: " when this is STAFF.',
  })
  lastMessageSenderType: 'CUSTOMER' | 'STAFF' | null;

  @ApiProperty({
    example: '2026-08-27T08:12:00.000Z',
    format: 'date-time',
    nullable: true,
    description: 'When the newest message arrived. Rows are sorted on this.',
  })
  lastMessageAt: Date | null;

  @ApiProperty({
    example: 3,
    description:
      'Messages the DISTRIBUTOR sent that are still unread by staff — the ' +
      'same definition and the same predicate as `unreadMessages` on ' +
      'GET /officers/customers (AO-C1), so the two cannot disagree. Always a ' +
      'number, `0` rather than omitted.',
  })
  unreadMessages: number;
}

export class PaginatedOfficerChatsResponseDto {
  @ApiProperty({ type: [OfficerChatListItemDto] })
  data: OfficerChatListItemDto[];

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

  @ApiProperty({
    example: '2026-08-19T09:15:00.000Z',
    format: 'date-time',
    description:
      'PRD §7 / US-10.7 — when this ERP-backed dataset was last synced.',
  })
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
  @ApiProperty({
    example: '2026-08-19T09:15:00.000Z',
    format: 'date-time',
    description:
      'PRD §7 / US-10.7 — when this ERP-backed dataset was last synced. NOT ' +
      'the time of the request: it reflects the most recent sync of the rows ' +
      'below, so the UI can render an honest "Last updated" stamp.',
  })
  lastUpdated: Date;

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

/**
 * One order on the Invoices tab. The same row GET /customers/me/invoices
 * returns, because it is produced by the same reader.
 */
export class CustomerInvoiceRowDto {
  @ApiProperty({ example: 'a1ce5c0f-36b3-4930-b4ef-8839e8f1db68' })
  id: string;

  @ApiProperty({
    example: '2310-202606110033',
    description: 'The ERP document number - what to show the distributor.',
  })
  erpId: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-11T00:00:00.000Z', format: 'date-time' })
  orderDate: Date;

  @ApiProperty({ example: 4264, description: 'Cartons on the order.' })
  totalItems: number;

  @ApiProperty({ example: 9942000 })
  totalValue: number;

  @ApiProperty({ example: 'CLOSED' })
  status: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  statusUpdatedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

export class CustomerInvoicesDto {
  @ApiProperty({
    example: '2026-08-19T09:15:00.000Z',
    format: 'date-time',
    description:
      'PRD §7 / US-10.7 — when this ERP-backed dataset was last synced. NOT ' +
      'the time of the request: it reflects the most recent sync of the rows ' +
      'below, so the UI can render an honest "Last updated" stamp.',
  })
  lastUpdated: Date;

  @ApiProperty({
    example: -50000.5,
    description: 'Outstanding balance, defaults to 0 if customer not found',
  })
  walletBalance: number;

  @ApiProperty({ type: [PaymentDto] })
  paymentHistory: PaymentDto[];

  @ApiProperty({
    type: [CustomerInvoiceRowDto],
    description:
      'One row per ORDER, byte-identical to GET /customers/me/invoices. No ' +
      'line items - open an order with ' +
      'GET /officers/customers/{id}/invoices/{invoiceId}.\n\n' +
      'REPLACES `invoices`, which was one unpaged array.',
  })
  data: CustomerInvoiceRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ---------------------------------------------------------------------------
// GET /officers/customers/:id/stock  -> OfficerService.getCustomerStock
// ---------------------------------------------------------------------------
const STOCK_STATUS_VALUES = ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
type StockStatus = (typeof STOCK_STATUS_VALUES)[number];

/** One product still to collect. Identical to the distributor's own row. */
export class CustomerStockItemDto {
  @ApiProperty({
    example: '101020104',
    nullable: true,
    description: 'ERP ITEM_CODE. Null where the feed carries none.',
  })
  itemCode: string | null;

  @ApiProperty({ example: 'Mr V Premium Table Water(Lagos)' })
  productName: string;

  @ApiProperty({ example: 800, description: 'Cartons ordered.' })
  quantityPaid: number;

  @ApiProperty({ example: 300, description: 'Cartons delivered.' })
  quantityLoaded: number;

  @ApiProperty({ example: 500, description: 'Cartons still to collect.' })
  quantityRemaining: number;

  @ApiProperty({
    example: '2026-06-11',
    nullable: true,
    description:
      'The most recent order date carrying this product, within the window ' +
      'if one was given.',
  })
  lastOrderDate: string | null;
}

export class CustomerStockDto {
  @ApiProperty({
    example: '2026-08-19T09:15:00.000Z',
    format: 'date-time',
    description:
      'PRD §7 / US-10.7 — when this ERP-backed dataset was last synced. NOT ' +
      'the time of the request.',
  })
  lastUpdated: Date;

  @ApiProperty({ example: 6206020, description: 'Cartons ordered in total.' })
  totalPurchasedCartons: number;

  @ApiProperty({ example: 6171733, description: 'Cartons collected.' })
  totalLoadedCartons: number;

  @ApiProperty({ example: 34287, description: 'Cartons still to collect.' })
  totalRemainingCartons: number;

  @ApiProperty({
    example: 99,
    description: 'loaded / purchased, as a percent.',
  })
  loadingProgress: number;

  @ApiProperty({
    type: [CustomerStockItemDto],
    description:
      'ONLY products with `quantityRemaining > 0`, so this does NOT sum to ' +
      '`totalPurchasedCartons`. A distributor holding nothing gets an empty ' +
      'array with non-zero totals.',
  })
  products: CustomerStockItemDto[];
}

/** GET /officers/stock - the same breakdown across a whole portfolio. */
export class PortfolioStockDto extends CustomerStockDto {
  @ApiProperty({
    example: 9,
    description:
      'How many distributors were counted - the caller`s portfolio, or every ' +
      'distributor for an ADMIN.',
  })
  customers: number;
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
  @ApiProperty({
    example: '2026-08-19T09:15:00.000Z',
    format: 'date-time',
    description:
      'PRD §7 / US-10.7 — when this ERP-backed dataset was last synced. NOT ' +
      'the time of the request: it reflects the most recent sync of the rows ' +
      'below, so the UI can render an honest "Last updated" stamp.',
  })
  lastUpdated: Date;

  @ApiProperty({
    type: [ErpWaybillDto],
    description:
      'The ERP`s own goods-movement documents, byte-identical to ' +
      'GET /customers/me/erp/waybills. REPLACES the loading requests this ' +
      'tab used to return - those are on GET /officers/loading-requests.',
  })
  data: ErpWaybillDto[];

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
