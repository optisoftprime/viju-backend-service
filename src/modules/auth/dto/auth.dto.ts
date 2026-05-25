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
