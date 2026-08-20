import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from './push.service';
import {
  RegisterDeviceDto,
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
} from './dto/push.dto';
import {
  DeviceRegisteredResponseDto,
  PushTokenResponseDto,
  UnregisterPushTokenResponseDto,
} from './dto/push-response.dto';

interface AuthUser {
  id: string;
  type: 'CUSTOMER' | 'STAFF';
}

@ApiTags('Push Notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@UseGuards(JwtAuthGuard)
@Controller('push-tokens')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a device push token for the authenticated user',
    description:
      'Idempotent: re-registering the same token updates platform and reactivates if previously unregistered.',
  })
  @ApiCreatedResponse({ type: PushTokenResponseDto })
  register(@CurrentUser() user: AuthUser, @Body() dto: RegisterPushTokenDto) {
    return this.pushService.register({
      token: dto.token,
      platform: dto.platform,
      recipientType: user.type,
      recipientId: user.id,
    });
  }

  @Delete()
  @ApiOperation({ summary: 'Soft-unregister a push token (e.g. on logout)' })
  @ApiOkResponse({ type: UnregisterPushTokenResponseDto })
  unregister(@Body() dto: UnregisterPushTokenDto) {
    return this.pushService.unregister(dto.token);
  }
}
