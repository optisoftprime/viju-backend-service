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
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import { Region } from '../../../common/region/region.constants';
import { SortQueryDto } from '../../../common/pagination/sort.dto';

/**
 * RA-T1 - the ticket status enum, in the order the Open Tickets page lists
 * them. Kept as a plain array so it can be echoed verbatim in the 400 body.
 */
export const TICKET_STATUS_VALUES = [
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.AWAITING_CUSTOMER,
  TicketStatus.RESOLVED,
] as const;

/** The exact message the frontend renders for a rejected `status` value. */
export const TICKET_STATUS_ERROR = `status must be one of: ${TICKET_STATUS_VALUES.join(', ')}`;

/**
 * RA-T1 - accepts `status` repeated (`?status=OPEN&status=IN_PROGRESS`) or
 * comma-separated (`?status=OPEN,IN_PROGRESS`), so "everything unresolved"
 * is one request. Values are upper-cased and de-duplicated; an unknown one is
 * rejected with a 400 carrying `code: "VALIDATION_ERROR"` rather than the
 * generic pipe message, because the page renders it verbatim.
 */
const toTicketStatusList = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null) return undefined;
  const parsed = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry !== '');
  if (parsed.length === 0) return undefined;

  const known: readonly string[] = TICKET_STATUS_VALUES;
  if (parsed.some((entry) => !known.includes(entry))) {
    throw new BadRequestException({
      message: TICKET_STATUS_ERROR,
      code: 'VALIDATION_ERROR',
      statusCode: HttpStatus.BAD_REQUEST,
    });
  }
  return [...new Set(parsed)] as TicketStatus[];
};

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
      'RA-T1 - ticket audit only. Narrows the result set to these statuses ' +
      'and makes `meta.total` count the FILTERED set, so the pager agrees ' +
      'with the rows on screen.\n\n' +
      'Repeatable (`?status=OPEN&status=IN_PROGRESS`) or comma-separated ' +
      '(`?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER`), so "everything ' +
      'unresolved" is one request. Case-insensitive. Omit for every status ' +
      '(the unchanged default). An unknown value is rejected with 400 and ' +
      '`code: "VALIDATION_ERROR"`.',
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
