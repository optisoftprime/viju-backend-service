import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';

/**
 * A single notification record. Matches the full scalar shape of the Prisma
 * `Notification` model (NotificationsService returns it with no `select`,
 * so every column is present and no relations are included).
 */
export class NotificationDto {
  @ApiProperty({ example: 'notification-uuid-1' })
  id: string;

  @ApiProperty({
    example: 'customer-uuid-1',
    nullable: true,
    description: 'Set when the notification targets a customer',
  })
  customerId: string | null;

  @ApiProperty({
    example: 'staff-uuid-1',
    nullable: true,
    description: 'Set when the notification targets a staff member',
  })
  staffId: string | null;

  @ApiProperty({ example: 'Your order #1234 has been delivered.' })
  content: string;

  @ApiProperty({ example: false })
  isRead: boolean;

  @ApiProperty({
    example: 'ORDER_UPDATE',
    nullable: true,
    description: 'Free-form notification category tag',
  })
  type: string | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

/**
 * Paginated payload for GET /api/v1/notifications/me.
 *
 * The service spreads the standard `{ data, meta }` paginate result and
 * prepends an `unread` count used for the notification badge.
 */
export class PaginatedNotificationsResponseDto {
  @ApiProperty({
    example: 3,
    description: 'Count of the current user’s unread notifications',
  })
  unread: number;

  @ApiProperty({ type: [NotificationDto] })
  data: NotificationDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

/**
 * Acknowledgement returned by PATCH /api/v1/notifications/me/read-all.
 */
export class MarkAllReadResponseDto {
  @ApiProperty({ example: true })
  ok: boolean;
}
