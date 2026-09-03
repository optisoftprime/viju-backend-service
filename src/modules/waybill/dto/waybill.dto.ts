import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsPositive,
  IsNumber,
  IsIn,
  Min,
  IsDefined,
  IsUUID,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

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

  @ApiPropertyOptional({
    example: '750ML(L)',
    nullable: true,
    description:
      'The `spec` the products endpoint returned, echoed back. It is what ' +
      'separates two products the ERP gives the same name, so a line without ' +
      'it cannot always be tied back to a product.',
  })
  @IsOptional()
  @IsString()
  spec?: string | null;

  @ApiPropertyOptional({
    example: 100,
    description:
      'The `quantityLeft` the products endpoint returned, echoed back, and ' +
      'stored as a snapshot of what the distributor was shown.\n\n' +
      '`quantityToLoad` MUST NOT EXCEED IT: a line loading more of a product ' +
      'than is left to collect is refused with a 400. Because the caller ' +
      'supplies this figure it is not trusted on its own - the same rule is ' +
      "also applied against the ERP's own outstanding quantity, summed " +
      'across every line naming that product. Omitting it therefore does ' +
      'not skip the check.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityLeft?: number;

  @ApiProperty({
    example: 20,
    description:
      'Cartons of this product to load - what the distributor typed." + NL + "' +
      'REQUIRED, but validated in the service rather than here, because the ' +
      'former name `quantity` is still accepted: a line must carry ONE of the ' +
      'two, and a line carrying neither is refused with a message naming ' +
      'both. Declaring it required here would reject an older client before ' +
      'that fallback could apply.\n\n' +
      'A SINGLE line may be 0 - a picker that lists every product on an order ' +
      'and lets the distributor fill in only some of them sends zeros for the ' +
      'rest. What must not be zero is the TOTAL across the request, which is ' +
      'checked in the service. Negatives are refused here.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityToLoad?: number;

  @ApiPropertyOptional({
    deprecated: true,
    example: 120,
    description:
      'The former name for `quantityToLoad`. Still accepted so older clients ' +
      'keep working; send `quantityToLoad` on anything new. When both are ' +
      'present `quantityToLoad` wins.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

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
    example: 'e8fef5ed-bdc5-4ee2-e902-1839e3c9ddd4',
    description:
      'The distributor the request is for.\n\n' +
      'REQUIRED, but it does NOT choose the account: the distributor is taken ' +
      'from the token. It is a cross-check - sending someone else`s id is ' +
      'refused with a 403 rather than quietly ignored, so a form that has ' +
      'the wrong customer loaded fails loudly instead of filing against the ' +
      'wrong account.',
  })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  requestedLoadingDate: string;

  @ApiPropertyOptional({ example: 320 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityCartons?: number;

  @ApiProperty({
    example: 'Yaba Warehouse',
    description: 'Where the load is going. Required.',
  })
  @IsString()
  @IsNotEmpty()
  destination: string;

  @ApiProperty({
    enum: WAREHOUSE_NAMES,
    example: 'LAGOS WAREHOUSE',
    description: 'The Viju warehouse the truck loads from. Required.',
  })
  @IsIn(WAREHOUSE_NAMES, {
    message: `warehouseName must be one of: ${WAREHOUSE_NAMES.join(', ')}`,
  })
  warehouseName: WarehouseName;

  @ApiProperty({
    example: 174,
    description:
      'The weight of the load IN KILOGRAMS. Required.\n\n' +
      'It must EQUAL the sum of the product lines: ' +
      'SUM(quantityToLoad x weightPerCarton), across every order. In the ' +
      'worked example 20 x 2.7 = 54 and 24 x 5 = 120, so this is 174. A ' +
      'value that disagrees is refused with a 400 and nothing is written.\n\n' +
      'A line sending no `weightPerCarton` is weighed from the Viju ' +
      'specification sheet instead, so omitting it does not skip the check. ' +
      'A product neither source can weigh is left out of the total and the ' +
      'request is allowed through - the check never rejects on a figure it ' +
      'cannot stand behind.',
  })
  @IsNumber()
  @IsPositive()
  loadingCapacity: number;

  @ApiProperty({
    type: [LoadingRequestProductDto],
    minItems: 1,
    description:
      'The products being loaded. AT LEAST ONE IS REQUIRED, and their ' +
      'quantities must ADD UP TO MORE THAN ZERO - a loading request that ' +
      'loads nothing is not a request. An individual line MAY be 0.\n\n' +
      'Pick them from GET /erp/orders/{customerId}/products, which is what ' +
      'the distributor still has to collect across ALL their open orders.\n\n' +
      'THE ONLY LINE SHAPE. The request is filed against the ACCOUNT, so it ' +
      'no longer names the orders it draws on: `orders` and ' +
      '`linkedPurchaseId` are gone - see the note on the endpoint.\n\n' +
      '`quantityCartons` is derived from the sum of the quantities; any value ' +
      'sent for it is ignored.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => LoadingRequestProductDto)
  products: LoadingRequestProductDto[];
}

/**
 * Editing a loading request that has not been acted on yet.
 *
 * Every field is optional: send only what changed. Anything omitted is left
 * as it was - EXCEPT the product lines, which are replaced wholesale when
 * `products` or `orders` is present, because a partial line list has no
 * sensible meaning ("these three lines, and whatever else was there" is not
 * something a form can express).
 *
 * `loadingCapacity` and the lines are validated together after the merge, so
 * changing one without the other is caught: editing the quantities and
 * leaving the old capacity behind is exactly the mistake the rule exists for.
 */
export class UpdateLoadingRequestDto {
  @ApiPropertyOptional({ example: 'LAG-234-XY' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  truckPlateNumber?: string;

  @ApiPropertyOptional({ example: 'Jimoh Ibrahim' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  driverName?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  driverPhone?: string;

  @ApiPropertyOptional({ example: '2026-06-15' })
  @IsOptional()
  @IsDateString()
  requestedLoadingDate?: string;

  @ApiPropertyOptional({ example: 'Yaba Warehouse' })
  @IsOptional()
  @IsString()
  destination?: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_NAMES, example: 'LAGOS WAREHOUSE' })
  @IsOptional()
  @IsIn(WAREHOUSE_NAMES, {
    message: `warehouseName must be one of: ${WAREHOUSE_NAMES.join(', ')}`,
  })
  warehouseName?: WarehouseName;

  @ApiPropertyOptional({
    example: 174,
    description:
      'Must still equal the weight of the load AFTER the edit - see ' +
      'POST /customers/me/waybills. Change it whenever you change a quantity.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  loadingCapacity?: number;

  @ApiPropertyOptional({
    type: [LoadingRequestProductDto],
    description:
      'REPLACES the product lines entirely. Omit to leave them alone; send ' +
      'an empty array to clear them.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => LoadingRequestProductDto)
  products?: LoadingRequestProductDto[];
}

/** How GET /customers/me/waybills may be ordered. */
export const WAYBILL_SORT_FIELDS = [
  'createdAt',
  'status',
  'requestedLoadingDate',
] as const;
export type WaybillSortField = (typeof WAYBILL_SORT_FIELDS)[number];

export class WaybillListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: WAYBILL_SORT_FIELDS,
    default: 'createdAt',
    description:
      'What to order by. `createdAt` (newest first) is the default." + NL + "' +
      '`status` orders by the LIFECYCLE, not alphabetically: ascending runs ' +
      'PENDING_ASSIGNMENT, ASSIGNED, LOADING_IN_PROGRESS, COMPLETED, ' +
      'CANCELLED - so what still needs doing comes first. Ties break on ' +
      '`createdAt` descending, so a page cannot shuffle between two requests.',
  })
  @IsOptional()
  @IsIn(WAYBILL_SORT_FIELDS)
  sortBy?: WaybillSortField;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'desc',
    description:
      'Ascending is the useful direction for `status`; descending for the ' +
      'two dates.',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
