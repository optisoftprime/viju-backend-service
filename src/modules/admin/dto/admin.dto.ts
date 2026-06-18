import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Region } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

/**
 * Query params for GET /admin/customers: optional region/search filter plus
 * pagination. Extends PaginationQueryDto so a single @Query() DTO covers every
 * query param — required under the global `forbidNonWhitelisted` pipe, which
 * rejects any property not declared on the bound DTO.
 */
export class CustomerFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Region, description: 'Optional region filter' })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({ description: 'Optional name / erpId search term' })
  @IsOptional()
  @IsString()
  search?: string;
}

/**
 * Query params for GET /admin/officers: optional region/search filter plus
 * pagination. Single @Query() DTO so every param is whitelisted under the
 * global `forbidNonWhitelisted` pipe.
 */
export class OfficerFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Region, description: 'Optional region filter' })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({ description: 'Optional name / email / phone search' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ReassignOfficerDto {
  @ApiProperty({ description: 'The user ID of the new Account Officer' })
  @IsString()
  @IsNotEmpty()
  newOfficerId: string;
}

export class CreateOfficerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
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
    description: 'Required for all non-admin staff',
  })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiProperty({ description: 'Temporary password for the new officer' })
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
