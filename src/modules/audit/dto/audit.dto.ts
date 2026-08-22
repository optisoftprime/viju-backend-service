import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { SortQueryDto } from '../../../common/pagination/sort.dto';
import {
  TICKET_STATUS_VALUES,
  TICKET_STATUS_ERROR,
  TICKET_STATUS_FILTER_DESCRIPTION,
  toTicketStatusList,
} from '../../../common/tickets/ticket-status-filter';

// Re-exported so existing importers of these two keep working; the definitions
// live in common/tickets so the officer ticket filter shares them verbatim.
export { TICKET_STATUS_VALUES, TICKET_STATUS_ERROR };

/** Columns GET /admin/audit/tickets can be sorted by (US-09.3). */
export const TICKET_AUDIT_SORT_FIELDS = [
  'ticketId',
  'subject',
  'customerName',
  'region',
  'status',
  'createdAt',
] as const;
export type TicketAuditSortField = (typeof TICKET_AUDIT_SORT_FIELDS)[number];

/**
 * Shared filter for both audit views. The chat audit (US-14.2) takes exactly
 * the same params as the ticket audit so the audits page can host it as a
 * second tab reusing the same table, filter and pagination code.
 */
export class InteractionAuditFilterDto extends SortQueryDto {
  @ApiPropertyOptional({ description: 'Distributor name (partial match)' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Officer name (partial match)' })
  @IsOptional()
  @IsString()
  officerName?: string;

  @ApiPropertyOptional({
    description:
      'B-4.2 — exact officer id. Prefer this over `officerName`, which is ' +
      'ambiguous when two officers share a name.',
    example: 'b1f2e3d4-5678-90ab-cdef-1234567890ab',
  })
  @IsOptional()
  @IsUUID()
  officerId?: string;

  @ApiPropertyOptional({
    description: 'B-4.2 — exact customer id.',
    example: 'c1f2e3d4-5678-90ab-cdef-1234567890ab',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ enum: Region })
  @IsOptional()
  @IsEnum(Region)
  region?: Region;

  @ApiPropertyOptional({
    description:
      'Keyword. Matches the message body on the chat audit; the subject or ' +
      'description on the ticket audit.',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on createdAt (ISO-8601)',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on createdAt (ISO-8601)',
    example: '2026-08-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    enum: TICKET_STATUS_VALUES,
    isArray: true,
    description:
      'RA-T1 - ticket audit only. ' + TICKET_STATUS_FILTER_DESCRIPTION,
    example: 'OPEN,IN_PROGRESS,AWAITING_CUSTOMER',
  })
  @IsOptional()
  @Transform(toTicketStatusList)
  @IsEnum(TicketStatus, { each: true, message: TICKET_STATUS_ERROR })
  status?: TicketStatus[];

  @ApiPropertyOptional({
    enum: TICKET_AUDIT_SORT_FIELDS,
    description:
      'Ticket audit only (US-09.3). Omit to keep the default ordering ' +
      '(createdAt descending). The chat audit is always ordered by most ' +
      'recent message. An unknown value is rejected with 400.',
  })
  @IsOptional()
  @IsIn(TICKET_AUDIT_SORT_FIELDS)
  sortBy?: TicketAuditSortField;
}
