import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const TICKET_CATEGORIES = [
  'ACCOUNT_QUERY',
  'DELIVERY_ISSUE',
  'PRODUCT_QUERY',
  'OTHER',
];
const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'RESOLVED',
];

/** Customer summary embedded in audit results (selected: id, name, region). */
export class AuditCustomerDto {
  @ApiProperty({ example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ example: 'Adeola Distributors Ltd' })
  name: string;

  @ApiProperty({ enum: REGION_VALUES, example: 'LAGOS' })
  region: Region;
}

/** Staff summary embedded in audit results (selected: id, name). */
export class AuditStaffDto {
  @ApiProperty({ example: 's1f2e3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ example: 'Chinedu Okafor' })
  name: string;
}

/** One message inside an audited chat thread. */
export class AuditChatMessageDto {
  @ApiProperty({ example: 'm1f2e3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF'], example: 'CUSTOMER' })
  senderType: string;

  @ApiProperty({
    example: 'When is my waybill ready?',
    nullable: true,
  })
  content: string | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/attachments/invoice-0912.pdf',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ example: '2026-08-18T16:38:00.000Z', format: 'date-time' })
  createdAt: Date;
}

/**
 * One customer/officer conversation (US-14.2). Mirrors the ticket audit row:
 * participants, a count, a recency stamp and the thread itself.
 */
export class AuditChatThreadDto {
  @ApiProperty({
    example:
      'c1f2e3d4-5678-90ab-cdef-1234567890ab:s1f2e3d4-5678-90ab-cdef-1234567890ab',
    description:
      'Thread identifier, `customerId:officerId`. Stable across requests.',
  })
  id: string;

  @ApiProperty({ type: AuditCustomerDto, nullable: true })
  customer: AuditCustomerDto | null;

  @ApiProperty({
    type: AuditStaffDto,
    nullable: true,
    description: 'The officer on this thread.',
  })
  officer: AuditStaffDto | null;

  @ApiProperty({
    example: 24,
    description:
      'Total messages on this thread that match the filter — not the length ' +
      'of the `messages` preview below.',
  })
  messageCount: number;

  @ApiProperty({
    example: '2026-08-18T16:40:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  lastMessageAt: Date | null;

  @ApiProperty({
    type: [AuditChatMessageDto],
    description:
      'Matching messages in chronological order, capped at the 200 most ' +
      'recent. Read-only — no write route is exposed from this view (US-14.3).',
  })
  messages: AuditChatMessageDto[];
}

/** Paginated chat audit search response. */
export class PaginatedAuditChatResponseDto {
  @ApiProperty({ type: [AuditChatThreadDto] })
  data: AuditChatThreadDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/** Single reply within a support ticket thread. */
export class AuditTicketReplyDto {
  @ApiProperty({ example: 'r1f2e3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ example: 't1f2e3d4-5678-90ab-cdef-1234567890ab' })
  ticketId: string;

  @ApiProperty({ enum: ['CUSTOMER', 'STAFF'], example: 'STAFF' })
  senderType: string;

  @ApiProperty({
    example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab',
    nullable: true,
  })
  customerId: string | null;

  @ApiProperty({
    example: 's1f2e3d4-5678-90ab-cdef-1234567890ab',
    nullable: true,
  })
  staffId: string | null;

  @ApiProperty({ example: 'Your delivery is scheduled for tomorrow morning.' })
  content: string;

  @ApiProperty({
    example: 'https://cdn.viju.example/attachments/schedule.pdf',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: AuditStaffDto, nullable: true })
  staff: AuditStaffDto | null;
}

/** Single support ticket (with full reply thread) returned by ticket audit. */
export class AuditTicketDto {
  @ApiProperty({ example: 't1f2e3d4-5678-90ab-cdef-1234567890ab' })
  id: string;

  @ApiProperty({ example: 'TKT-2026-000142' })
  ticketId: string;

  @ApiProperty({ example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab' })
  customerId: string;

  @ApiProperty({ enum: TICKET_CATEGORIES, example: 'DELIVERY_ISSUE' })
  category: string;

  @ApiProperty({ example: 'Late delivery for order #0912' })
  subject: string;

  @ApiProperty({
    example: 'The order placed last week has not arrived yet.',
  })
  description: string;

  @ApiProperty({
    example: 'https://cdn.viju.example/attachments/photo.jpg',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ enum: TICKET_STATUSES, example: 'OPEN' })
  status: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T09:01:22.120Z', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: AuditCustomerDto })
  customer: AuditCustomerDto;

  @ApiProperty({ type: [AuditTicketReplyDto] })
  replies: AuditTicketReplyDto[];
}

/** Paginated ticket audit search response. */
export class PaginatedAuditTicketResponseDto {
  @ApiProperty({ type: [AuditTicketDto] })
  data: AuditTicketDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
