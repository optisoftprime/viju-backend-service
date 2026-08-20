import { IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  REALTIME_CHANNELS,
  RealtimeChannel,
} from '../../../infrastructure/realtime/realtime.types';

/**
 * Query params for GET /realtime/stream.
 *
 * `token` is accepted here (as well as in the Authorization header) because
 * the browser `EventSource` API cannot set request headers. It is the same
 * access token, validated by the same JWT strategy.
 */
export class RealtimeStreamQueryDto {
  @ApiPropertyOptional({
    description:
      'Access token. Required for browser EventSource clients, which cannot ' +
      'send an Authorization header. Omit it when you can send ' +
      '`Authorization: Bearer <access_token>` instead.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated channel filter. Defaults to all channels when absent.',
    enum: REALTIME_CHANNELS,
    isArray: true,
    example: 'chat,tickets,notifications',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : value,
  )
  @IsIn(REALTIME_CHANNELS, { each: true })
  channels?: RealtimeChannel[];
}

// ─── Event frame payloads (documentation only) ─────────────
// These describe the `data` object inside each SSE frame. They are never
// used as a controller return type — @Sse() streams frames — but they give
// Swagger something concrete to render for the FE.

export class ChatMessageEventDto {
  @ApiProperty({ example: 'message-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'customer-uuid-1',
    description: 'Id of the sender (customer id or staff id)',
  })
  senderId: string;

  @ApiProperty({
    example: 'staff-uuid-1',
    description: 'Id of the recipient (staff id or customer id)',
  })
  receiverId: string;

  @ApiProperty({ example: 'Hello', nullable: true })
  content: string | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/chat/attachment.jpg',
    nullable: true,
  })
  attachmentUrl: string | null;

  @ApiProperty({ example: '2026-08-19T09:12:00.000Z', format: 'date-time' })
  createdAt: Date;
}

export class TicketUpdatedEventDto {
  @ApiProperty({ example: 'ticket-uuid-1' })
  id: string;

  @ApiProperty({ example: 'TKT-1042', description: 'Human-facing ticket ref' })
  ticketId: string;

  @ApiProperty({
    enum: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'],
    example: 'IN_PROGRESS',
  })
  status: string;
}

export class NotificationCreatedEventDto {
  @ApiProperty({ example: 'notification-uuid-1' })
  id: string;

  @ApiProperty({ example: 'New message from Ade Foods Ltd' })
  content: string;

  @ApiProperty({ example: 'CHAT_MESSAGE', nullable: true })
  type: string | null;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiProperty({ example: '2026-08-19T09:12:00.000Z', format: 'date-time' })
  createdAt: Date;
}
