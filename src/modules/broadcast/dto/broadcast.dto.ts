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
  ArrayMaxSize,
  ArrayNotEmpty,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastType } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

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

  @ApiProperty({
    example: 'New stock of Viju Chocolate is available from Monday',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  message: string;
}

export class SendIndividualBroadcastDto {
  @ApiPropertyOptional({
    description:
      'Distributor (Customer.id) to receive the broadcast. Send this OR ' +
      '`customerIds` — at least one is required.',
  })
  @ValidateIf((o: SendIndividualBroadcastDto) => o.customerIds === undefined)
  @IsUUID()
  customerId: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['bd5dbe51-b00e-4d05-a321-76108e0f3918'],
    description:
      'B-2 — several distributors on one send. Each receives their OWN ' +
      'broadcast record and their own notification, so history and delivery ' +
      'counts stay per-recipient.\n\n' +
      'ALLOWANCE SEMANTICS: `deliveryAllowance` is credited PER RECIPIENT, ' +
      'not split between them — 12 recipients at ₦1,000 credits ₦12,000 in ' +
      'total. This matches what the form states before sending.\n\n' +
      'Duplicates are collapsed. Maximum 200 per call.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: 'customerIds must contain at least one id' })
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  customerIds?: string[];

  @ApiProperty({
    example: 'Delivery allowance credited for Q1 loyalty programme',
  })
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

export class BroadcastHistoryFilterDto extends PaginationQueryDto {
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

  @ApiPropertyOptional({
    example: 'depot',
    description:
      'B-1 — case-insensitive partial match on the broadcast `reference`, the ' +
      '`message` body, and the RECIPIENT: the target customer’s name for an ' +
      'individual broadcast. Applied server-side, so it searches the whole ' +
      'history rather than one page of it, and `meta.total` is the size of ' +
      'the filtered set.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
