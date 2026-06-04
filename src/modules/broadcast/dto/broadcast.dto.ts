import {
  IsArray,
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Region, BroadcastType } from '@prisma/client';

export class SendRegionalBroadcastDto {
  @ApiProperty({
    enum: Region,
    isArray: true,
    description: 'One or more regions whose distributors will receive the push',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Region, { each: true })
  regions: Region[];

  @ApiProperty({ example: 'New stock of Viju Chocolate is available from Monday' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  message: string;
}

export class SendIndividualBroadcastDto {
  @ApiProperty({ description: 'Distributor (Customer.id) to receive the broadcast' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 'Delivery allowance credited for Q1 loyalty programme' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  message: string;

  @ApiPropertyOptional({
    description:
      'If set (>0), credited to wallet immediately and a Payment row is ' +
      'created with reference "Delivery Allowance" (PRD F15 AC5).',
    example: 80000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryAllowance?: number;
}

export class BroadcastHistoryFilterDto {
  @ApiPropertyOptional({ enum: BroadcastType })
  @IsOptional()
  @IsEnum(BroadcastType)
  type?: BroadcastType;

  @ApiPropertyOptional({ enum: Region })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
