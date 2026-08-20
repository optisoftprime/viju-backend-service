import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({
    description:
      'Device push token from FCM (Android), APNs (iOS), or Web Push',
    example: 'cKx4...:APA91bH...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}

/**
 * AO-13 — body for POST /devices/register, the route mobile clients use to
 * tell the backend where to deliver push. Same registration as
 * POST /push-tokens, with the field name the mobile contract uses.
 */
export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Device push token from FCM (Android) or APNs (iOS)',
    example: 'fcm_or_apns_token',
  })
  @IsString()
  @IsNotEmpty()
  deviceToken: string;

  @ApiProperty({
    enum: [DevicePlatform.IOS, DevicePlatform.ANDROID],
    example: DevicePlatform.IOS,
  })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}

export class UnregisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}
