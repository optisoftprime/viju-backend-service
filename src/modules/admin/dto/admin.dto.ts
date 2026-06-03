import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Region } from '@prisma/client';

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
