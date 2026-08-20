import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from './pagination.dto';

/** Sort direction accepted by every sortable list endpoint. */
export const SORT_ORDER_VALUES = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDER_VALUES)[number];

/**
 * Base for query DTOs on sortable list endpoints (US-09.3).
 *
 * Only `sortOrder` lives here — `sortBy` is declared by each route's own DTO
 * with an `@IsIn([...])` of the columns THAT route can sort by, so an unknown
 * column is rejected by the global ValidationPipe with a 400 instead of being
 * silently ignored.
 *
 * Both params are optional. When `sortBy` is absent the service keeps its
 * pre-existing default ordering, so callers that don't sort see no change.
 */
export class SortQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: SORT_ORDER_VALUES,
    default: 'desc',
    description:
      'Sort direction. Only applied when `sortBy` is also supplied; ignored otherwise.',
  })
  @IsOptional()
  @IsIn(SORT_ORDER_VALUES)
  sortOrder?: SortOrder;
}

/**
 * Normalises `sortOrder` to a Prisma-compatible direction, defaulting to
 * `desc` as documented.
 */
export function sortDirection(order?: SortOrder): SortOrder {
  return order === 'asc' ? 'asc' : 'desc';
}

/**
 * Comparator for sorts that cannot be expressed as a Prisma `orderBy` —
 * derived columns (aggregates computed after the query, e.g. lastPurchaseDate
 * or an open-ticket count). Pair with `paginateInMemory`.
 *
 * `null`/`undefined` always sort last, in both directions, so empty cells stay
 * at the bottom of the table where the UI expects them.
 */
export function compareBy<T>(
  select: (row: T) => string | number | Date | null | undefined,
  order: SortOrder,
): (a: T, b: T) => number {
  const direction = order === 'asc' ? 1 : -1;
  return (a, b) => {
    const left = select(a);
    const right = select(b);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    const l = left instanceof Date ? left.getTime() : left;
    const r = right instanceof Date ? right.getTime() : right;
    if (typeof l === 'string' && typeof r === 'string') {
      return l.localeCompare(r) * direction;
    }
    return (l < r ? -1 : l > r ? 1 : 0) * direction;
  };
}
