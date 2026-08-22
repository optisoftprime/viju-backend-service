import { BadRequestException, HttpStatus } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';

/**
 * The ticket status enum, in the order the Open Tickets pages list them. Kept
 * as a plain array so it can be echoed verbatim in the 400 body.
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
 * Shared `@Transform` for every `status` query filter (RA-T1, AO-T1).
 *
 * Accepts the parameter repeated (`?status=OPEN&status=IN_PROGRESS`) or
 * comma-separated (`?status=OPEN,IN_PROGRESS`), so "everything unresolved" is
 * one request. Values are trimmed, upper-cased and de-duplicated; omitting the
 * parameter leaves it `undefined`, which every caller reads as "every status".
 *
 * An unknown value is rejected with a 400 carrying `code: "VALIDATION_ERROR"`
 * rather than the generic pipe message, because the pages render it verbatim.
 *
 * One implementation, imported by both the audit filter and the officer ticket
 * filter, so the two cannot drift apart.
 */
export const toTicketStatusList = ({ value }: { value: unknown }) => {
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

/** Swagger description shared by every `status` filter. */
export const TICKET_STATUS_FILTER_DESCRIPTION =
  'Narrows the result set to these ticket statuses, and makes `meta.total` ' +
  'count the FILTERED set so the pager agrees with the rows on screen. ' +
  'Repeatable (`?status=OPEN&status=IN_PROGRESS`) or comma-separated ' +
  '(`?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER`), so "everything unresolved" ' +
  'is one request. Case-insensitive and de-duplicated. Omit for every status ' +
  '(the unchanged default). An unknown value is rejected with 400 and ' +
  '`code: "VALIDATION_ERROR"`.';
