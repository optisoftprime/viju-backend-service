import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ example: 'staff-uuid-1' })
  staffId: string;

  @ApiProperty({ enum: SENDER_TYPE_VALUES, example: 'CUSTOMER' })
  senderType: SenderType;

  @ApiProperty({ example: 'Hello, I have a question about my order.', nullable: true })
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

  @ApiProperty({ example: 'Hello, I have a question about my order.', nullable: true })
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
