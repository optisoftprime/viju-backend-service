import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  TICKET_STATUS_VALUES,
  TICKET_STATUS_ERROR,
  TICKET_STATUS_FILTER_DESCRIPTION,
  toTicketStatusList,
} from '../../../common/tickets/ticket-status-filter';

/**
 * AO-T1 - query params for GET /tickets/officer.
 *
 * Extends the pagination DTO so a single @Query() covers every param, which
 * the global `forbidNonWhitelisted` pipe requires.
 */
export class OfficerTicketsFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'AO-T1 - narrow to ONE distributor, for the Tickets tab inside a ' +
      'distributor detail view. Must be a UUID; a malformed value is ' +
      'rejected with 400, and so is a customer that is not assigned to the ' +
      'calling officer. `meta.total` counts only that customer\u2019s tickets.',
    example: 'bd5dbe51-b00e-4d05-a321-76108e0f3918',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'customerId must be a valid UUID',
  })
  customerId?: string;

  @ApiPropertyOptional({
    enum: TICKET_STATUS_VALUES,
    isArray: true,
    description: 'AO-T1 - ' + TICKET_STATUS_FILTER_DESCRIPTION,
    example: 'OPEN,IN_PROGRESS',
  })
  @IsOptional()
  @Transform(toTicketStatusList)
  @IsEnum(TicketStatus, { each: true, message: TICKET_STATUS_ERROR })
  status?: TicketStatus[];
}

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
