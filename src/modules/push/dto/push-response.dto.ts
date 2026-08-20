import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';

// ─── Registered push token (POST /push-tokens) ─────────────

export class PushTokenResponseDto {
  @ApiProperty({ example: 'push-token-uuid-1' })
  id: string;

  // The raw device token is intentionally NOT returned — see PushService.register.

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.ANDROID })
  platform: DevicePlatform;

  @ApiProperty({
    example: 'customer-uuid-1',
    nullable: true,
    description: 'Set when the token belongs to a customer',
  })
  customerId: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Set when the token belongs to a staff member',
  })
  staffId: string | null;

  @ApiProperty({ example: true, description: 'False once soft-unregistered' })
  isActive: boolean;

  @ApiProperty({
    example: '2026-06-09T08:16:56.533Z',
    format: 'date-time',
    nullable: true,
  })
  lastUsedAt: Date | null;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  updatedAt: Date;
}

// ─── Device registration (POST /devices/register) ──────────

export class DeviceRegisteredResponseDto {
  @ApiProperty({ example: 'Device registered' })
  message: string;
}

// ─── Unregister acknowledgement (DELETE /push-tokens) ──────

export class UnregisterPushTokenResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}
