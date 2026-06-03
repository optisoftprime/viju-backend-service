import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestOtpDto {
  @ApiProperty({ description: 'Customer phone number registered with ERP' })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ description: 'Customer phone number' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: '6-digit OTP' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  code: string;

  @ApiProperty({ description: 'New password to set after verification' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}

export class CustomerLoginDto {
  @ApiProperty({ description: 'Customer phone number' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ description: 'Customer password' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class StaffLoginDto {
  @ApiProperty({ description: 'Staff email address' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Staff password' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class StaffWebLoginDto {
  @ApiProperty({
    description: 'ERP username (PRD F11 - replaces email/password for web)',
    example: 'james.o',
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description: 'ERP-issued code (acts as password for web portal)',
    example: 'twye79woe88',
  })
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class StaffPasswordResetRequestDto {
  @ApiProperty({
    description:
      "Officer's registered phone number or email address (PRD F18 #7)",
    example: 'james.o@viju.example',
  })
  @IsString()
  @IsNotEmpty()
  identifier: string;
}

export class StaffPasswordResetConfirmDto {
  @ApiProperty({ description: 'Identifier used in the request step' })
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @ApiProperty({ description: '6-digit OTP delivered via SMS or email' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  code: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}
