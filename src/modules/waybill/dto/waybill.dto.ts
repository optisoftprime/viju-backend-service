import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  IsNumber,
  IsIn,
  Min,
  IsUUID,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The Viju warehouses a truck can load from. */
export const WAREHOUSE_NAMES = [
  'LAGOS WAREHOUSE',
  'OGUN WAREHOUSE',
  'ABUJA WAREHOUSE',
] as const;
export type WarehouseName = (typeof WAREHOUSE_NAMES)[number];

/** Most lines seen on one ERP order is a handful; this is a sanity bound. */
const MAX_PRODUCTS_PER_REQUEST = 200;

/**
 * One product on a loading request.
 *
 * The distributor picks these from GET /erp/orders/{orderId}/products, so
 * `productId` and `weightPerCarton` are that endpoint's values echoed back.
 * Both are nullable there - the specification sheet does not cover every
 * product - so both are optional here. Only the name and quantity are needed
 * to record what is being loaded.
 */
export class LoadingRequestProductDto {
  @ApiPropertyOptional({
    example: '101020104',
    nullable: true,
    description:
      'ERP item code, as returned by GET /erp/orders/{orderId}/products. ' +
      'Omit or send null when that endpoint returned null.',
  })
  @IsOptional()
  @IsString()
  productId?: string | null;

  @ApiProperty({
    example: '750ml water(L-水)',
    description:
      'ITEM_DESCRIPTION, exactly as the products endpoint returned it.',
  })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({
    example: 120,
    description: 'Cartons of this product to load.',
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    example: 9.38,
    nullable: true,
    description:
      'Kilograms per carton, as returned by the products endpoint. Omit or ' +
      'send null when it returned null.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightPerCarton?: number | null;
}

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

  @ApiPropertyOptional({
    enum: WAREHOUSE_NAMES,
    example: 'LAGOS WAREHOUSE',
    description: 'The Viju warehouse the truck loads from.',
  })
  @IsOptional()
  @IsIn(WAREHOUSE_NAMES, {
    message: `warehouseName must be one of: ${WAREHOUSE_NAMES.join(', ')}`,
  })
  warehouseName?: WarehouseName;

  @ApiPropertyOptional({
    example: 1200,
    description:
      'The TRUCK’s carton capacity, not the size of this load. The load is ' +
      'the sum of `products[].quantity`.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  loadingCapacity?: number;

  @ApiPropertyOptional({
    type: [LoadingRequestProductDto],
    description:
      'The products being loaded, taken from ' +
      'GET /erp/orders/{orderId}/products for the same `linkedPurchaseId`. ' +
      'When present, `quantityCartons` is derived from the sum of the ' +
      'quantities and any value sent for it is ignored.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => LoadingRequestProductDto)
  products?: LoadingRequestProductDto[];
}
