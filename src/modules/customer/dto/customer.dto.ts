import { IsString, IsNotEmpty, IsOptional, MinLength, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfilePhotoDto {
  @ApiProperty({ description: 'URL or base64 of the uploaded photo' })
  @IsString()
  @IsNotEmpty()
  photoUrl: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'New password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

export class PurchaseFilterDto {
  @ApiPropertyOptional({ description: 'Search term for product name or order ID' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Start date filter' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
