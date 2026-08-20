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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

class ErpPurchaseItemDto {
  @ApiPropertyOptional({
    description: 'ERP item code (ITEM_ID) for this line (B-5.4)',
    example: 'ITM-0099',
  })
  @IsOptional()
  @IsString()
  itemCode?: string;

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

  @ApiProperty({ type: [ErpPurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ErpPurchaseItemDto)
  items: ErpPurchaseItemDto[];
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
