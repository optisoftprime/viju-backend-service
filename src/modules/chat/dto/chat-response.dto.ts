import { ApiProperty } from '@nestjs/swagger';
import { StaffSenderDto } from '../../../common/messaging/staff-sender.dto';

const SENDER_TYPE_VALUES = ['CUSTOMER', 'STAFF'] as const;
type SenderType = (typeof SENDER_TYPE_VALUES)[number];

const SENDER_LABEL_VALUES = ['Viju Account Officer', 'You'] as const;
type SenderLabel = (typeof SENDER_LABEL_VALUES)[number];

// ─── Raw message row (officer / legacy / audit endpoints) ──
// Mirrors the full Prisma `Message` model returned by findMany/create
// without a `select`.

export class MessageDto {
  @ApiProperty({ example: 'message-uuid-1' })
  id: string;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({
    example: 'staff-uuid-1',
    description:
      'On a STAFF-authored row this is the author. On a CUSTOMER-authored row ' +
      'it is the officer the message was routed TO, which is why `staff` is ' +
      'null there rather than naming them as the sender.',
  })
  staffId: string;

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

  @ApiProperty({ enum: SENDER_TYPE_VALUES, example: 'CUSTOMER' })
  senderType: SenderType;

  @ApiProperty({
    example: 'Hello, I have a question about my order.',
    nullable: true,
  })
  content: string | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/chat/attachment.jpg',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    example: '2026-06-09T08:20:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  readAt: Date | null;
}

// ─── Customer-facing thread message (GET /chat/me) ─────────
// Service selects a subset of columns (no customerId/staffId) and adds a
// derived `senderLabel`. Real officer identities are never exposed (PRD F6).

export class CustomerThreadMessageDto {
  @ApiProperty({ example: 'message-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'Hello, I have a question about my order.',
    nullable: true,
  })
  content: string | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/chat/attachment.jpg',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ enum: SENDER_TYPE_VALUES, example: 'STAFF' })
  senderType: SenderType;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    example: '2026-06-09T08:20:00.000Z',
    format: 'date-time',
    nullable: true,
  })
  readAt: Date | null;

  @ApiProperty({
    enum: SENDER_LABEL_VALUES,
    example: 'Viju Account Officer',
    description:
      'Generic display label — "Viju Account Officer" for staff messages, "You" for the customer’s own messages.',
  })
  senderLabel: SenderLabel;
}

// ─── Customer-sent message (POST /chat/me) ─────────────────
// Returns the full created `Message` row plus a derived `senderLabel`,
// which is always "You" for the customer’s own message.

export class CustomerSentMessageDto extends MessageDto {
  @ApiProperty({
    enum: SENDER_LABEL_VALUES,
    example: 'You',
    description: 'Always "You" — this is the customer’s own message.',
  })
  senderLabel: SenderLabel;
}

// ─── Mark-as-read acknowledgement (PATCH /chat/me/read) ────

export class MarkReadResponseDto {
  @ApiProperty({ example: true })
  ok: boolean;
}

// ─── Staff mark-as-read (PATCH /chat/{customerId}/read) — C-1 ──

/**
 * C-1 — the acknowledgement for the staff side of the thread.
 *
 * Reports the row count rather than a bare `ok`, so a client can tell "there
 * was nothing unread" (0) from "3 messages cleared" and reconcile the
 * dashboard's `unReadMessage` tile against it.
 */
export class StaffMarkReadResponseDto {
  @ApiProperty({
    example: 'bd5dbe51-b00e-4d05-a321-76108e0f3918',
    description: 'The distributor whose thread was marked read.',
  })
  customerId: string;

  @ApiProperty({
    example: 3,
    description:
      'How many CUSTOMER-authored messages this call moved from unread to ' +
      'read. Zero when the thread was already clear — the call is idempotent.',
  })
  markedRead: number;
}
