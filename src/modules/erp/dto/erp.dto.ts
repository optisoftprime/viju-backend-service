import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SyncBalanceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  erpId: string;

  @ApiProperty()
  @IsNumber()
  outstandingBalance: number;
}

export class SyncStockDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  erpId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;
}

class PurchaseItemDto {
  @ApiProperty()
  @IsString()
  productName: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiProperty()
  @IsNumber()
  unitPrice: number;

  @ApiProperty()
  @IsNumber()
  lineTotal: number;
}

export class SyncPurchaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  erpId: string; // Purchase Invoice ID

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerErpId: string;

  @ApiProperty()
  @IsString()
  orderDate: string;

  @ApiProperty()
  @IsNumber()
  totalItems: number;

  @ApiProperty()
  @IsNumber()
  totalValue: number;

  @ApiProperty({
    enum: ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
  })
  @IsEnum(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'])
  status: any;

  @ApiProperty({ type: [PurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];
}

export class SyncPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  erpId: string; // Receipt ID

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerErpId: string;

  @ApiProperty()
  @IsString()
  date: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty()
  @IsNumber()
  runningBalance: number;
}
