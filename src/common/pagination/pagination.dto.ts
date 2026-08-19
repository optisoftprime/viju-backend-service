import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard pagination query params. Apply with `@Query() pagination: PaginationQueryDto`.
 * Defaults: page=1, pageSize=20. Hard cap pageSize=100.
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
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
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

  @ApiProperty({ example: 20, description: 'Records per page' })
  pageSize: number;

  @ApiProperty({ example: 8, description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}
