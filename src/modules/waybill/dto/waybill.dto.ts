import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  IsNumber,
  IsIn,
  Min,
  IsDefined,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  IsObject,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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
  // The products endpoint returns this as a string, and echoing it back
  // verbatim is the safe habit - an ERP code that ever gained a leading zero
  // would lose it as a number. A number is accepted and coerced anyway, so a
  // client that sends 101020104 is not turned away over quoting.
  @Transform(({ value }) =>
    typeof value === 'number' ? String(value) : (value as unknown),
  )
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
    description:
      'The order(s) this request is raised against. Send an ARRAY when the ' +
      'truck loads from several - normally the same ids used as the `orders` ' +
      'keys. A single string is still accepted for the one-order case.\n\n' +
      'Each entry is either a `Purchase.id` uuid (what ' +
      'GET /customers/me/invoices returns as `id`) or the ERP DOC_NO ' +
      '(`erpId`). Every one must belong to the caller.\n\n' +
      'THE FIRST ENTRY IS THE PRIMARY ORDER: the request is filed under it ' +
      'and `reference` is derived from its DOC_NO. When an array is sent, ' +
      'every entry must also appear as a key of `orders` - an order the ' +
      'request names but loads nothing from would otherwise be silently ' +
      'dropped.',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' }, minItems: 1 },
    ],
    example: [
      'f7a86c0a-1ee9-40d0-85a0-5334f6da100c',
      'ea95bb9e-e470-4743-ab20-618841ea9abf',
    ],
  })
  @IsDefined()
  linkedPurchaseId: string | string[];

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
    example: 2000,
    description:
      'The TRUCK’s carrying capacity IN KILOGRAMS - what it can haul, not ' +
      'the size of this load.\n\n' +
      'The load is weighed against it before the request is accepted: ' +
      'SUM(quantity x weightPerCarton) across every line, over every order. ' +
      'A load heavier than this is refused with a 400 and nothing is ' +
      'written.\n\n' +
      'A line sending no `weightPerCarton` is weighed from the Viju ' +
      'specification sheet instead, so omitting it does not skip the ' +
      'check. A product neither source can weigh is left out of the total ' +
      'and the request is allowed through - the check never rejects on a ' +
      'figure it cannot stand behind.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  loadingCapacity?: number;

  @ApiPropertyOptional({
    type: [LoadingRequestProductDto],
    description:
      'SINGLE-ORDER form: the products being loaded, all from the order named ' +
      'by `linkedPurchaseId`. Use `orders` instead to load from several ' +
      'orders at once. When either is present, `quantityCartons` is derived ' +
      'from the sum of the quantities and any value sent for it is ignored.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => LoadingRequestProductDto)
  products?: LoadingRequestProductDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { $ref: '#/components/schemas/LoadingRequestProductDto' },
    },
    example: {
      '2310-202606110033': [
        {
          productId: '101020104',
          productName: '750ml water(L-水)',
          quantity: 120,
          weightPerCarton: 9.38,
        },
      ],
      '2301-202606090060': [
        {
          productId: null,
          productName: '18.9L water(L)',
          quantity: 80,
          weightPerCarton: null,
        },
      ],
    },
    description:
      'MULTI-ORDER form: the products being loaded, keyed by the order each ' +
      'came from. One loading request can draw on several orders, so this ' +
      'supersedes `products`; send one or the other, not both.\n\n' +
      'Each key is an order - either a `Purchase.id` uuid or the ERP DOC_NO ' +
      '(`Purchase.erpId`). Every order must belong to the caller, or the ' +
      'request is refused.\n\n' +
      '`linkedPurchaseId` stays required and lists the same orders; its ' +
      'FIRST entry is the primary one, which `reference` is derived from.',
  })
  @IsOptional()
  @IsObject()
  orders?: Record<string, LoadingRequestProductDto[]>;
}
