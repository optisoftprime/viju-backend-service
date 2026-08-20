import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard pagination query params. Apply with `@Query() pagination: PaginationQueryDto`.
 * Defaults: page=1, pageSize=20.
 *
 * `pageSize` accepts ANY positive integer — the portal has a free numeric
 * page-size input, and rejecting an over-large value with a 400 would make
 * that input feel broken. The value is clamped server-side to
 * MAX_PAGE_SIZE and the applied value is echoed back in `meta.pageSize`, so
 * the client can show what it actually got.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    example: 20,
    description:
      'Rows per page. Any positive integer is accepted; values above 200 are ' +
      'clamped to 200 rather than rejected. Check `meta.pageSize` for the ' +
      'value that was actually applied.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number = 20;
}

/**
 * Shape of the `meta` block returned alongside every paginated response.
 * Mirrors `PaginationMeta` produced by the `paginate()` helper.
 */
export class PaginationMetaDto {
  @ApiProperty({ example: 150, description: 'Total matching records' })
  total: number;

  @ApiProperty({ example: 1, description: 'Current page (1-based)' })
  page: number;

  @ApiProperty({
    example: 20,
    description:
      'Records per page as APPLIED — a requested pageSize above the 200 cap ' +
      'is clamped, and this is the clamped value.',
  })
  pageSize: number;

  @ApiProperty({ example: 8, description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}
