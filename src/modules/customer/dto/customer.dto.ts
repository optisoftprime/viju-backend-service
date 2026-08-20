import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  IsDateString,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';
import {
  STATEMENT_PERIODS,
  StatementPeriod,
} from '../statement-ledger.service';

export class UpdateProfilePhotoDto {
  @ApiProperty({ description: 'URL or base64 of the uploaded photo' })
  @IsString()
  @IsNotEmpty()
  photoUrl: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'New password' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;
}

export class StatementRangeDto {
  @ApiPropertyOptional({
    enum: STATEMENT_PERIODS,
    default: 'LAST_30_DAYS',
    description:
      'B-5.2 — the window to report on. Defaults to LAST_30_DAYS when ' +
      'omitted. `startDate` and `endDate` are required only for CUSTOM.',
  })
  @IsOptional()
  @IsIn(STATEMENT_PERIODS)
  period?: StatementPeriod;

  @ApiPropertyOptional({
    description: 'ISO date — inclusive start. Required when period=CUSTOM.',
    example: '2026-07-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'ISO date — inclusive end. Required when period=CUSTOM.',
    example: '2026-07-31',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class PurchaseFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term for product name or order ID',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Start date filter' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
