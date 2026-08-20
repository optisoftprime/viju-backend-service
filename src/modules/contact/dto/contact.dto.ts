import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Public contact form (CC-05).
 *
 * The rules mirror the validation the marketing form already applies on the
 * client, so a submission that passes there passes here — and one that
 * bypasses the form still cannot post junk.
 */
export class CreateContactMessageDto {
  @ApiProperty({ example: 'Ada Obi', minLength: 2, maxLength: 120 })
  @IsString()
  @Length(2, 120)
  fullName: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+2348012345678',
    minLength: 7,
    maxLength: 20,
    description: 'Digits and + - ( ) only',
  })
  @IsString()
  @Length(7, 20)
  @Matches(/^[0-9+\-() ]+$/, {
    message: 'phone may contain only digits and + - ( ) characters',
  })
  phone: string;

  @ApiProperty({
    example: 'I would like to discuss a distributorship.',
    minLength: 10,
    maxLength: 2000,
  })
  @IsString()
  @Length(10, 2000)
  message: string;
}
