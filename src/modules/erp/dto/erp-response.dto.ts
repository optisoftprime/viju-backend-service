import { ApiProperty } from '@nestjs/swagger';

/**
 * Acknowledgement returned by every ERP sync webhook endpoint.
 *
 * The controller discards the persisted Prisma record and always responds with
 * a fixed `{ success, message }` envelope, so this DTO reflects exactly that
 * shape (not the underlying entity).
 */
export class ErpSyncResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Balance synced successfully' })
  message: string;
}
