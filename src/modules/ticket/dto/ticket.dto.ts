import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTicketDto {
  @ApiProperty({
    enum: ['ACCOUNT_QUERY', 'DELIVERY_ISSUE', 'PRODUCT_QUERY', 'OTHER'],
    example: 'DELIVERY_ISSUE',
  })
  @IsEnum(['ACCOUNT_QUERY', 'DELIVERY_ISSUE', 'PRODUCT_QUERY', 'OTHER'])
  category: any;

  @ApiProperty({ example: 'Late delivery for order ORD-00294' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: 'The order placed last week has not arrived yet.' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/viju/ticket-attachments/photo.jpg',
  })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

export class ReplyTicketDto {
  @ApiProperty({ example: 'Your delivery is scheduled for tomorrow morning.' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/viju/ticket-attachments/schedule.pdf',
  })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

export class UpdateTicketStatusDto {
  @ApiProperty({
    enum: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'],
    example: 'IN_PROGRESS',
    description:
      'Side effect (US-11.7): the distributor is notified in-app and by push, ' +
      'and a `ticket.updated` frame is published on /realtime/stream.',
  })
  @IsEnum(['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'RESOLVED'])
  status: any;
}
