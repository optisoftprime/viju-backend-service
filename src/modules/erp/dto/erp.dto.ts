import {
  IsString,
  IsNotEmpty,
  IsNumber,
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

  // Deliberately a free-form string, not an enum. The published mapping in
  // `order-status.ts` is the single place that decides what an ERP state
  // means; pinning a short enum here re-broke that, because a payload
  // carrying a perfectly valid state such as LOADED or CLOSED was rejected
  // with a 400 before the mapping was ever consulted. Unrecognised states are
  // logged and read as PENDING rather than refused.
  @ApiProperty({
    example: 'DELIVERED',
    description:
      'ERP order state. Matched case-insensitively against the published ' +
      'mapping table (PENDING, PROCESSING, APPROVED, LOADED, DISPATCHED, ' +
      'IN_TRANSIT, DELIVERED, CLOSED, COMPLETED, CANCELLED, …). An ' +
      'unrecognised state is accepted and stored as PENDING, never as a ' +
      'misleading PROCESSING.',
  })
  @IsString()
  status: string;

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
