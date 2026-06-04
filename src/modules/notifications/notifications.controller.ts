import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface AuthUser {
  id: string;
  role: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'List my notifications (PRD §6, both mobile + web bell)',
    description:
      'Works for any authenticated user (customer or staff). Returns the ' +
      '100 most recent notifications and an unread count for the badge.',
  })
  async list(@CurrentUser() user: AuthUser) {
    const isCustomer = user.role === 'CUSTOMER';
    return isCustomer
      ? this.notificationsService.listForCustomer(user.id)
      : this.notificationsService.listForStaff(user.id);
  }

  @Patch('me/read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  async readAll(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllRead(
      user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      user.id,
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationsService.markRead(
      user.role === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      user.id,
      id,
    );
  }
}
