import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsEnum,
  IsIn,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { SortQueryDto } from '../../../common/pagination/sort.dto';

/**
 * Query-string booleans arrive as strings. Anything unrecognised is left
 * untouched so @IsBoolean() rejects it rather than silently reading as false.
 */
const toOptionalBool = ({ value }: { value: unknown }) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
};

/** Columns GET /admin/customers can be sorted by (US-09.3, B-1.1). */
export const CUSTOMER_SORT_FIELDS = [
  'name',
  'erpId',
  'region',
  'outstandingBalance',
  'supportTickets',
  'createdAt',
] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

/** Columns GET /admin/officers can be sorted by (US-09.3). */
export const OFFICER_SORT_FIELDS = [
  'name',
  'email',
  'region',
  'customers',
  'createdAt',
  'lastLoginAt',
  'supportTickets',
] as const;
export type OfficerSortField = (typeof OFFICER_SORT_FIELDS)[number];

/**
 * Query params for GET /admin/customers: optional region/search filter plus
 * pagination. Extends PaginationQueryDto so a single @Query() DTO covers every
 * query param — required under the global `forbidNonWhitelisted` pipe, which
 * rejects any property not declared on the bound DTO.
 */
export class CustomerFilterDto extends SortQueryDto {
  @ApiPropertyOptional({ enum: Region, description: 'Optional region filter' })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({ description: 'Optional name / erpId search term' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: CUSTOMER_SORT_FIELDS,
    description:
      'Column to sort by. Omit to keep the default ordering (erpId ascending). ' +
      '`supportTickets` sorts by the open-ticket count shown in the table.',
  })
  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS)
  sortBy?: CustomerSortField;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'B-1.1 — filter on officer assignment. `true` returns only customers ' +
      'that already have an assigned officer, `false` only those without. ' +
      'Omit for both. Lets the assignment screen stop fetching every page and ' +
      'filtering client-side.',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  hasOfficer?: boolean;
}

/**
 * Query params for GET /admin/officers: optional region/search filter plus
 * pagination. Single @Query() DTO so every param is whitelisted under the
 * global `forbidNonWhitelisted` pipe.
 */
export class OfficerFilterDto extends SortQueryDto {
  @ApiPropertyOptional({
    enum: Region,
    description:
      'Optional region filter. Ignored for REGIONAL_ADMIN callers, who are ' +
      "always forced to their own token's region (RA-05).",
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({ description: 'Optional name / email / phone search' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: StaffRole,
    default: StaffRole.OFFICER,
    description:
      'Staff role to list. Defaults to OFFICER. Pass LOADING_OFFICER to ' +
      'populate the assign-loading-officer picker on the regional admin ' +
      'portal (RA-06).',
  })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @ApiPropertyOptional({
    enum: OFFICER_SORT_FIELDS,
    description:
      'Column to sort by. Omit to keep the default ordering (name ascending). ' +
      '`customers` sorts by _count.customers, `supportTickets` by the open ' +
      "ticket count across that officer's customers.",
  })
  @IsOptional()
  @IsIn(OFFICER_SORT_FIELDS)
  sortBy?: OfficerSortField;
}

/**
 * Body for PATCH /admin/officers/:id — activate or deactivate an officer
 * (US-15.4 / US-15.5).
 */
export class UpdateOfficerStatusDto {
  @ApiProperty({
    example: false,
    description:
      'false deactivates the officer (refused with 409 while they still ' +
      'hold customers); true reactivates them.',
  })
  @IsBoolean()
  isActive: boolean;
}

export class ReassignOfficerDto {
  @ApiProperty({
    description: 'The user ID of the new Account Officer',
    example: 'stf_7',
  })
  @IsString()
  @IsNotEmpty()
  newOfficerId: string;
}

export class CreateOfficerDto {
  @ApiProperty({ example: 'Ifeanyi Okon' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'i.okon@viju.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Officer phone number - fixed once set (PRD F18 #3)',
    example: '+2348012345678',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    enum: Region,
    required: false,
    example: Region.LAGOS,
    description: 'Required for all non-admin staff',
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiProperty({
    description:
      'Temporary password for the new officer. It is emailed to them ' +
      'verbatim (US-15.3), so treat it as one-time.',
    example: 'TempPass123',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}

export class CreateProductFlyerDto {
  @ApiProperty({ example: 'Viju Apple Drink 400ml' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Uploaded image URL',
    example: 'https://cdn.viju.ng/flyers/apple.jpg',
  })
  @IsString()
  @IsNotEmpty()
  imageUrl: string;
}

export class UpdateProductFlyerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  isActive?: boolean;
}

export class ReorderProductFlyersDto {
  @ApiProperty({
    description:
      'Ordered list of flyer IDs, top-to-bottom as they should appear in the mobile carousel',
    type: [String],
  })
  @IsString({ each: true })
  orderedIds: string[];
}

export class CreateTestCustomerDto {
  @ApiProperty({ example: '+2348012345678' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Test Distributor Ltd' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: Region, example: Region.LAGOS })
  @IsEnum(Region)
  region: Region;

  @ApiProperty({
    required: false,
    description:
      'ERP customer ID. If omitted, a MOCK- prefixed ID is generated. Will collide with real ERP IDs once F8 sync lands.',
  })
  @IsOptional()
  @IsString()
  erpId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}
