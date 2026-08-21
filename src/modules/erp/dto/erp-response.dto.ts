import { ApiProperty } from '@nestjs/swagger';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

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

/**
 * Outcome of an order-status reconcile (B-5.5). Unlike the webhooks above this
 * one reports what it did, so the caller can see whether the ERP feed was
 * reachable and how many orders actually moved.
 */
export class ErpOrderStatusSyncResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Order statuses reconciled with the ERP' })
  message: string;

  @ApiProperty({
    example: 5639,
    description: 'Orders whose status changed on this pass.',
  })
  updated: number;

  @ApiProperty({
    example: true,
    description:
      'False when this database carries no erp_raw feed — nothing was changed.',
  })
  available: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when another instance held the lock, so this pass did nothing.',
  })
  skipped: boolean;
}

/**
 * Outcome of an account-balance reconcile. Like the order-status pass above it
 * reports what it did, so the caller can see whether the ERP credit feed was
 * reachable and how many balances actually moved.
 */
export class ErpAccountBalanceSyncResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Account balances reconciled with the ERP' })
  message: string;

  @ApiProperty({
    example: 1473,
    description: 'Customers whose balance changed on this pass.',
  })
  updated: number;

  @ApiProperty({
    example: true,
    description:
      'False when this database carries no erp_raw.raw_customer_credit feed — ' +
      'nothing was changed.',
  })
  available: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when another instance held the lock, so this pass did nothing.',
  })
  skipped: boolean;
}

/**
 * Outcome of a default-officer reconcile. Like the order-status pass above it
 * reports what it did, so the caller can see whether the default officer was
 * resolvable and how many customers were actually parked on them.
 */
export class ErpDefaultOfficerSyncResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    example: 'Parked 412 unassigned customer(s) on james.o@viju.example',
  })
  message: string;

  @ApiProperty({
    example: 412,
    description:
      'Customers in `region` that had no account officer and were assigned on ' +
      'this pass. Customers an admin already assigned, and customers in every ' +
      'other region, are never counted or touched.',
  })
  assigned: number;

  @ApiProperty({
    enum: REGION_VALUES,
    example: 'LAGOS',
    description:
      'The ONLY region this pass considered — DEFAULT_ACCOUNT_OFFICER_REGION, ' +
      'LAGOS by default. Customers elsewhere are left for a regional officer.',
  })
  region: Region;

  @ApiProperty({
    example: 'james.o@viju.example',
    description:
      'The officer unassigned customers in `region` are parked on — ' +
      'DEFAULT_ACCOUNT_OFFICER_EMAIL, or james.o@viju.example when unset.',
  })
  officerEmail: string;

  @ApiProperty({
    example: true,
    description:
      'False when no active OFFICER carries that email — nothing was changed.',
  })
  available: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when another instance held the lock, so this pass did nothing.',
  })
  skipped: boolean;
}
