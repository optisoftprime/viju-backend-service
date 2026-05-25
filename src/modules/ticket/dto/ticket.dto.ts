import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({ enum: ['ACCOUNT_QUERY', 'DELIVERY_ISSUE', 'PRODUCT_QUERY', 'OTHER'] })
  @IsEnum(['ACCOUNT_QUERY', 'DELIVERY_ISSUE', 'PRODUCT_QUERY', 'OTHER'])
  category: any;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

export class ReplyTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

export class UpdateTicketStatusDto {
  @ApiProperty({ enum: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'] })
  @IsEnum(['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'])
  status: any;
}
