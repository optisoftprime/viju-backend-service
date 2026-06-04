import { IsUUID, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignLoadingOfficerDto {
  @ApiProperty({ description: 'Staff ID of the loading / warehouse officer' })
  @IsUUID()
  loadingOfficerId: string;
}

export class UpdateLoadingStatusDto {
  @ApiProperty({
    enum: ['LOADING_IN_PROGRESS', 'COMPLETED'],
    description:
      'Officer can advance from ASSIGNED → LOADING_IN_PROGRESS → COMPLETED. ' +
      'On COMPLETED, waybillDocumentUrl is required.',
  })
  @IsString()
  status: 'LOADING_IN_PROGRESS' | 'COMPLETED';

  @ApiPropertyOptional({
    description: 'Required when status is COMPLETED — uploaded waybill / loading bill PDF URL',
  })
  @IsOptional()
  @IsString()
  waybillDocumentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
