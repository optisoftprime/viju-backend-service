import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  NotificationDto,
  PaginatedNotificationsResponseDto,
  MarkAllReadResponseDto,
} from './dto/notifications-response.dto';

interface AuthUser {
  id: string;
  role: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'List my notifications (both mobile + web bell)',
    description:
      'Works for any authenticated user (customer or staff). Paginated, ' +
      'newest first, with `unread` for the badge count.\n\n' +
      'Rows are created server-side as a side effect of the flows that ' +
      'warrant them, and the AUDIENCE IS DECIDED AT WRITE TIME - every row ' +
      'you read here was addressed to you, so no client-side filtering is ' +
      'needed and `unread` can drive the badge directly (N-1):\n' +
      '- CHAT_MESSAGE: exactly ONE staff recipient, the staff member the ' +
      'conversation belongs to. Another officer on the same account, an ' +
      'admin and a regional admin get nothing.\n' +
      '- WAYBILL_SUBMITTED: one row per active REGIONAL_ADMIN of the ' +
      'request\u2019s own region. Never ADMIN, never OFFICER.\n' +
      '- WAYBILL_ASSIGNED: one row for the ASSIGNED loading officer, plus the ' +
      'distributor\u2019s own row on their feed.\n' +
      '- ASSIGNMENT: one row for the INCOMING officer only - not the outgoing ' +
      'officer, the acting admin or the regional admin (US-13.4).\n' +
      '- TICKET_*: the officers on the account, or the distributor on the ' +
      'other side.\n\n' +
      'On a staff row `staffId` is the recipient and `customerId` names the ' +
      'distributor the row is about, which is the bell\u2019s deep-link target. ' +
      '`type` is a closed enum so the bell can pick an icon and route the ' +
      'click.\n\n' +
      'For live updates without polling, subscribe to GET /realtime/stream ' +
      'and invalidate this query when a `notification.created` frame ' +
      'arrives (US-11.2).',
  })
  @ApiOkResponse({ type: PaginatedNotificationsResponseDto })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() pagination: PaginationQueryDto,
  ) {
    const isCustomer = user.role === 'CUSTOMER';
    return isCustomer
      ? this.notificationsService.listForCustomer(user.id, pagination)
      : this.notificationsService.listForStaff(user.id, pagination);
  }

  @Patch('me/read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  async readAll(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(
      user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      user.id,
    );
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark a single notification as read',
    description: "Only the caller's own notifications can be marked read.",
  })
  @ApiParam({ name: 'id', description: 'Notification id' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    description: 'Notification not found, or not addressed to the caller',
  })
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationsService.markRead(
      user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      user.id,
      id,
    );
  }
}
