import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class RegisterPushTokenDto {
  @ApiProperty({
    description: 'Device push token from FCM (Android), APNs (iOS), or Web Push',
    example: 'cKx4...:APA91bH...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}

export class UnregisterPushTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;
}
