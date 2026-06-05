export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Builds the meta block for a paginated response.
 */
export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMeta {
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  return {
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Generic paginator. Counts and fetches concurrently.
 *
 *   return paginate(
 *     () => prisma.customer.count({ where }),
 *     (skip, take) => prisma.customer.findMany({ where, skip, take, orderBy: ... }),
 *     pagination,
 *   );
 */
export async function paginate<T>(
  count: () => Promise<number>,
  fetch: (skip: number, take: number) => Promise<T[]>,
  pagination: { page: number; pageSize: number },
): Promise<PaginatedResponse<T>> {
  const page = Math.max(1, Math.floor(pagination.page || 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(pagination.pageSize || 20)),
  );
  const skip = (page - 1) * pageSize;
  const [total, data] = await Promise.all([count(), fetch(skip, pageSize)]);
  return { data, meta: buildPaginationMeta(total, page, pageSize) };
}

/**
 * In-memory paginator — for endpoints whose underlying source isn't
 * directly paginable at the SQL layer (cross-DB aggregation, computed
 * derivations). Prefer the SQL-level `paginate` whenever possible.
 */
export function paginateInMemory<T>(
  rows: T[],
  pagination: { page: number; pageSize: number },
): PaginatedResponse<T> {
  const page = Math.max(1, Math.floor(pagination.page || 1));
  const pageSize = Math.min(
    100,
    Math.max(1, Math.floor(pagination.pageSize || 20)),
  );
  const start = (page - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    meta: buildPaginationMeta(rows.length, page, pageSize),
  };
}
