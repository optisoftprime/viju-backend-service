import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AcceptTermsDto {
  @ApiProperty({
    description: 'Hash/identifier of the T&C version the customer accepted',
    example: 'viju-tnc-v1',
  })
  @IsString()
  @IsNotEmpty()
  termsVersion: string;
}

export class SubmitLoadingRequestDto {
  @ApiProperty({ example: 'LAG-234-XY' })
  @IsString()
  @IsNotEmpty()
  truckPlateNumber: string;

  @ApiProperty({ example: 'Jimoh Ibrahim' })
  @IsString()
  @IsNotEmpty()
  driverName: string;

  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  driverPhone: string;

  @ApiProperty({
    description: 'Purchase / order ID the distributor wants loaded',
    example: 'uuid-of-purchase',
  })
  @IsUUID()
  linkedPurchaseId: string;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  requestedLoadingDate: string;

  @ApiPropertyOptional({ example: 320 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantityCartons?: number;

  @ApiPropertyOptional({ example: 'Yaba Warehouse' })
  @IsOptional()
  @IsString()
  destination?: string;
}
