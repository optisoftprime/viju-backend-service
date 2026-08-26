import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MaxLength,
  MinLength,
  IsEnum,
  IsIn,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayNotEmpty,
  ArrayMaxSize,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { SortQueryDto } from '../../../common/pagination/sort.dto';
import {
  CREATABLE_STAFF_ROLE_VALUES,
  MANAGED_STAFF_ROLE_VALUES,
} from '../../../common/roles/managed-roles';

/**
 * Trims incoming strings so a whitespace-only value fails @IsNotEmpty()
 * instead of being stored as " ". Non-strings are passed through untouched so
 * the type validators still see (and reject) them.
 */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Emails are stored and compared lower-cased, so duplicates cannot differ by case. */
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

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

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'Include ERP customers that have not been projected into the portal ' +
      'yet. Default `false`, so existing callers are unaffected.\n\n' +
      'With `true`, `meta.total` becomes the size of the union (projected + ' +
      'unprojected) so paging stays arithmetically correct, `meta` gains ' +
      '`projectedTotal` / `unprojectedTotal`, and each row carries ' +
      '`isProjected`. Unprojected rows have `id: null` and null for every ' +
      'field the ERP customer master does not carry.\n\n' +
      'Rows whose BP_CLUSTER_CODE is not a Viju region (1-5) are excluded in ' +
      'both modes. Any value other than true/false is rejected with 400.',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  includeUnprojected?: boolean;
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
      'portal (RA-06), or ADMIN / REGIONAL_ADMIN to list those internally ' +
      'managed users. Pass `managed` instead to list all four managed roles ' +
      'at once.',
  })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'When set, lists every internally managed role (' +
      MANAGED_STAFF_ROLE_VALUES.join(', ') +
      ') in one page instead of a single role. Overrides `role`.',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  managed?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Filter on account status. `true` returns only active users, `false` ' +
      'only deactivated ones. Omit for both (unchanged default).',
  })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  isActive?: boolean;

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
  @ApiPropertyOptional({
    example: false,
    description:
      'false deactivates the user (refused with 409 while an account officer ' +
      'still holds customers); true reactivates them. Idempotent — sending ' +
      'the status the user already has returns 200 with `changed: false`.\n\n' +
      'O-1: now OPTIONAL. Omit it to edit the profile fields below without ' +
      'touching the account’s status. Sending it alone behaves exactly as ' +
      'before.',
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive must be a boolean' })
  isActive?: boolean;

  // ─── O-1: profile fields. Every one optional; only what is PRESENT is
  // applied, so an unchanged password is never resubmitted and therefore
  // never rotated. Validation mirrors CreateOfficerDto exactly, so the same
  // input rejects the same way on both routes.

  @ApiPropertyOptional({
    example: 'Ada Obi',
    minLength: 2,
    maxLength: 120,
    description: 'O-1 — the user’s full name.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name cannot be empty' })
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: '+2348012345678',
    description: 'O-1 — the user’s phone number.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[0-9][0-9\s-]{6,19}$/, {
    message: 'phone must be 7-20 digits, optionally prefixed with +',
  })
  phone?: string;

  @ApiPropertyOptional({
    enum: Region,
    example: Region.LAGOS,
    description:
      'O-1 — the user’s region. Refused with 400 `REGION_NOT_ALLOWED` on an ' +
      'ADMIN, who is organisation-wide.',
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({
    example: 'TempPass123',
    minLength: 8,
    maxLength: 72,
    description:
      'O-1 — a new password. NOT emailed to the user: the admin passes it on ' +
      'themselves. Send it only when it actually changed — omitting it leaves ' +
      'the existing credential untouched.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  // bcrypt silently ignores bytes past 72; refuse rather than truncate.
  @MaxLength(72)
  password?: string;
}

/**
 * O-2 — move a selection of officers to one region in a single call.
 *
 * Replaces N fan-out requests over PATCH /admin/officers/{id}. Results are
 * reported per officer, never all-or-nothing: moving nine and failing the
 * tenth leaves nine moved.
 */
export class BulkOfficerRegionDto {
  @ApiProperty({
    type: [String],
    example: ['1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081'],
    description: 'The officers to move. Duplicates are collapsed.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'officerIds must contain at least one id' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  officerIds: string[];

  @ApiProperty({
    enum: Region,
    example: Region.OTHERS,
    description:
      'The region to move them to. An ADMIN in the selection is refused with ' +
      'REGION_NOT_ALLOWED and named in `failed`; everyone else still moves.',
  })
  @IsEnum(Region)
  region: Region;
}

/**
 * C-2 — assign a selection of customers to one account officer.
 *
 * Replaces N fan-out requests over PATCH /admin/customers/{id}/reassign.
 */
export class BulkReassignCustomersDto {
  @ApiProperty({
    type: [String],
    example: ['bd5dbe51-b00e-4d05-a321-76108e0f3918'],
    description: 'The customers to reassign. Duplicates are collapsed.',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'customerIds must contain at least one id' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  customerIds: string[];

  @ApiProperty({
    example: '7c2a09d3-6f61-49c2-9a0e-8d5b1f2c3a44',
    description:
      'The receiving account officer. Must be ACTIVE and in the same region ' +
      'as each customer — a customer in another region is named in `failed` ' +
      'with OFFICER_NOT_FOUND.',
  })
  @IsString()
  @IsNotEmpty({ message: 'newOfficerId is required' })
  newOfficerId: string;
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

/**
 * Body for POST /admin/officers — an ADMIN provisions one internally managed
 * staff account (PRD "Change in User Source").
 *
 * Only the fields declared here are accepted: the global ValidationPipe runs
 * with `whitelist` + `forbidNonWhitelisted`, so a client cannot smuggle in
 * `id`, `isActive`, `erpCode`, `createdById` or any other privileged column.
 */
export class CreateOfficerDto {
  @ApiProperty({ example: 'Ifeanyi Okon', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'i.okon@viju.com', maxLength: 255 })
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty({ message: 'email is required' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'Officer phone number - fixed once set (PRD F18 #3)',
    example: '+2348012345678',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'phone is required' })
  @Matches(/^\+?[0-9][0-9\s-]{6,19}$/, {
    message: 'phone must be 7-20 digits, optionally prefixed with +',
  })
  phone: string;

  @ApiPropertyOptional({
    enum: CREATABLE_STAFF_ROLE_VALUES,
    default: StaffRole.OFFICER,
    description:
      'Role to provision. Defaults to OFFICER (account officer) so existing ' +
      'clients that omit it are unaffected. `ACCOUNT_OFFICER` is accepted as ' +
      'an alias for OFFICER. Any other value — including WAREHOUSE_OFFICER, ' +
      'which the ERP still owns — is rejected with 400.',
  })
  @IsOptional()
  @Transform(trim)
  @IsIn(CREATABLE_STAFF_ROLE_VALUES, {
    message: `role must be one of: ${CREATABLE_STAFF_ROLE_VALUES.join(', ')}`,
  })
  role?: string;

  @ApiProperty({
    enum: Region,
    required: false,
    example: Region.LAGOS,
    description:
      'Required for REGIONAL_ADMIN, OFFICER and LOADING_OFFICER. ADMIN is ' +
      'org-wide and must NOT carry a region.',
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiProperty({
    description:
      'Temporary password for the new user. It is emailed to them ' +
      'verbatim (US-15.3), so treat it as one-time.',
    example: 'TempPass123',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MinLength(8)
  // bcrypt silently ignores bytes past 72; refuse rather than truncate.
  @MaxLength(72)
  password: string;
}

/** F-1 — cap on the flyer's own copy, matching what the admin form enforces. */
export const FLYER_DESCRIPTION_MAX_LENGTH = 500;

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

  @ApiPropertyOptional({
    maxLength: FLYER_DESCRIPTION_MAX_LENGTH,
    description:
      'F-1 — the promotion’s own copy: terms, dates and small print the ' +
      'artwork cannot carry as readable text. Optional; omit it (or send an ' +
      'empty string) and the flyer is stored with `description: null`. ' +
      'Trimmed on the way in and capped at ' +
      FLYER_DESCRIPTION_MAX_LENGTH +
      ' characters.',
    example:
      'Buy 50 cartons of Viju Milk between 1-31 December and get 5 free.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FLYER_DESCRIPTION_MAX_LENGTH)
  description?: string;
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

  @ApiPropertyOptional({
    maxLength: FLYER_DESCRIPTION_MAX_LENGTH,
    description:
      'F-1 — the promotion’s own copy. OMIT the property to leave the ' +
      'stored value unchanged; send an EMPTY STRING to clear it back to ' +
      'null. Trimmed and capped at ' +
      FLYER_DESCRIPTION_MAX_LENGTH +
      ' characters.',
    example:
      'Buy 50 cartons of Viju Milk between 1-31 December and get 5 free.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FLYER_DESCRIPTION_MAX_LENGTH)
  description?: string;
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
