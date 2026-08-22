import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { StaffSenderDto } from '../../../common/messaging/staff-sender.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const TICKET_CATEGORIES = [
  'ACCOUNT_QUERY',
  'DELIVERY_ISSUE',
  'PRODUCT_QUERY',
  'OTHER',
] as const;

const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'RESOLVED',
] as const;

const SENDER_TYPES = ['CUSTOMER', 'STAFF'] as const;

const ACCOUNT_STATUSES = ['ACTIVE', 'ON_HOLD'] as const;

/**
 * Bare SupportTicket record — shape returned by `createTicket`
 * (`prisma.supportTicket.create`) and by each item of `getCustomerTickets`
 * (`findMany` with no `include`).
 */
export class TicketResponseDto {
  @ApiProperty({ example: 'b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d' })
  id: string;

  @ApiProperty({ example: 'TKT-A1B2C3' })
  ticketId: string;

  @ApiProperty({ example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210' })
  customerId: string;

  @ApiProperty({ enum: TICKET_CATEGORIES, example: 'DELIVERY_ISSUE' })
  category: (typeof TICKET_CATEGORIES)[number];

  @ApiProperty({ example: 'Order not delivered' })
  subject: string;

  @ApiProperty({
    example: 'My order placed last week has not arrived yet.',
  })
  description: string;

  @ApiProperty({
    example: 'https://cdn.example.com/uploads/receipt.png',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ enum: TICKET_STATUSES, example: 'OPEN' })
  status: (typeof TICKET_STATUSES)[number];

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

/**
 * Customer summary attached to officer-facing ticket lists (AO-T1).
 *
 * Widened from { name, erpId } so the Tickets tab can render the distributor
 * header straight from the row it already holds.
 */
export class TicketCustomerSummaryDto {
  @ApiProperty({ example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210' })
  id: string;

  @ApiProperty({ example: 'ERP-00123' })
  erpId: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'jane.doe@example.com', nullable: true })
  email: string | null;
}

/**
 * SupportTicket with the customer summary and reply count, as returned by each
 * item of `getAssignedTickets`.
 */
export class OfficerTicketResponseDto extends TicketResponseDto {
  @ApiProperty({
    example: 1,
    description:
      'AO-T1 - number of replies on the thread, so the list can show a ' +
      'conversation badge without fetching each thread.',
  })
  repliesCount: number;

  @ApiProperty({ type: () => TicketCustomerSummaryDto })
  customer: TicketCustomerSummaryDto;
}

/**
 * Full customer scalar record as included by `getTicket`
 * (`include: { customer: true }`).
 *
 * NOTE: the underlying Prisma `Customer` row also contains a `password`
 * (hash) column. It is intentionally OMITTED here and must never be
 * serialised to clients.
 */
export class TicketCustomerDto {
  @ApiProperty({ example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210' })
  id: string;

  @ApiProperty({ example: 'ERP-00123' })
  erpId: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'jane.doe@example.com', nullable: true })
  email: string | null;

  @ApiProperty({
    example: 'https://cdn.example.com/avatars/jane.png',
    nullable: true,
  })
  profilePhotoUrl: string | null;

  @ApiProperty({ enum: ACCOUNT_STATUSES, example: 'ACTIVE' })
  accountStatus: (typeof ACCOUNT_STATUSES)[number];

  @ApiProperty({ example: 12500.5 })
  outstandingBalance: number;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;

  @ApiProperty({ example: 0 })
  failedLoginAttempts: number;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  lockedUntil: Date | null;

  @ApiProperty({
    example: '7c6d5e4f-3a2b-1098-7654-3210fedcba98',
    nullable: true,
  })
  assignedOfficerId: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

/**
 * A single reply in a ticket thread. Mirrors the `TicketReply` model and the
 * shape returned by `replyToTicket` and each item of `getTicket().replies`.
 */
export class TicketReplyResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'b3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d' })
  ticketId: string;

  @ApiProperty({ enum: SENDER_TYPES, example: 'CUSTOMER' })
  senderType: (typeof SENDER_TYPES)[number];

  @ApiProperty({
    example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210',
    nullable: true,
  })
  customerId: string | null;

  @ApiProperty({
    example: '7c6d5e4f-3a2b-1098-7654-3210fedcba98',
    nullable: true,
  })
  staffId: string | null;

  @ApiProperty({
    type: () => StaffSenderDto,
    nullable: true,
    description:
      'S-1 - who wrote this message. Present on every STAFF-authored row; ' +
      'null on a customer-authored one. Read `staff.role` to label the ' +
      'sender (Admin / Regional Admin / Account Officer) instead of a flat ' +
      '"Staff".',
  })
  staff: StaffSenderDto | null;

  @ApiProperty({ example: 'Thanks, I have escalated this to the team.' })
  content: string;

  @ApiProperty({
    example: 'https://cdn.example.com/uploads/screenshot.png',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

/**
 * Full ticket thread as returned by `getTicket`
 * (`include: { replies: ..., customer: true }`).
 */
export class TicketThreadResponseDto extends TicketResponseDto {
  @ApiProperty({ type: () => [TicketReplyResponseDto] })
  replies: TicketReplyResponseDto[];

  @ApiProperty({ type: () => TicketCustomerDto })
  customer: TicketCustomerDto;
}

/**
 * AD-T1 — the body of `POST /tickets/{id}/replies`.
 *
 * The complete thread (identical to `GET /tickets/{id}`) with the new reply
 * already appended, so the caller can re-render from the response instead of
 * refetching. `reply` echoes the row that was just created.
 */
export class TicketThreadWithReplyResponseDto extends TicketThreadResponseDto {
  @ApiProperty({
    type: () => TicketReplyResponseDto,
    description:
      'The reply just created — the last element of `replies`, echoed for ' +
      'callers that only need that row.',
  })
  reply: TicketReplyResponseDto;
}

/**
 * Paginated list of bare tickets (customer-facing list).
 */
export class PaginatedTicketResponseDto {
  @ApiProperty({ type: () => [TicketResponseDto] })
  data: TicketResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Paginated list of tickets with customer summaries (officer-facing list).
 */
export class PaginatedOfficerTicketResponseDto {
  @ApiProperty({ type: () => [OfficerTicketResponseDto] })
  data: OfficerTicketResponseDto[];

  @ApiProperty({ type: () => PaginationMetaDto })
  meta: PaginationMetaDto;
}
