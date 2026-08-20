import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from './push.service';
import { RegisterDeviceDto } from './dto/push.dto';
import { DeviceRegisteredResponseDto } from './dto/push-response.dto';

interface AuthUser {
  id: string;
  type: 'CUSTOMER' | 'STAFF';
}

/**
 * AO-13 — device registration for the mobile app.
 *
 * The backend already fans chat sends, ticket replies and ticket status
 * changes out to push through NotificationService; this route is how a device
 * tells it where to deliver. It is the mobile-contract spelling of
 * POST /push-tokens and shares the same storage and idempotency, so a device
 * may use either.
 */
@ApiTags('Push Notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@UseGuards(JwtAuthGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register this device for push notifications',
    description:
      'Idempotent: re-registering the same token updates its platform, ' +
      're-points it at the current user and reactivates it if it had been ' +
      'unregistered. The token is never echoed back.\n\n' +
      'Once registered, the device receives a push whenever the officer ' +
      'replies to a ticket, changes a ticket status, or sends a chat ' +
      'message (US-11.7). The payload carries `data.type` from the ' +
      'notification type enum plus the id of the record to open.',
  })
  @ApiCreatedResponse({ type: DeviceRegisteredResponseDto })
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceRegisteredResponseDto> {
    await this.pushService.register({
      token: dto.deviceToken,
      platform: dto.platform,
      recipientType: user.type,
      recipientId: user.id,
    });
    return { message: 'Device registered' };
  }
}
