import { IsString, IsNotEmpty, IsEmail, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ description: 'Temporary password for the new officer' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
