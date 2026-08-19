import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/pagination/pagination.dto';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const BROADCAST_TYPE_VALUES = ['REGIONAL', 'INDIVIDUAL'] as const;
type BroadcastType = (typeof BROADCAST_TYPE_VALUES)[number];

// ─── Base broadcast (full scalar columns) ──────────────────
// Returned verbatim by POST /admin/broadcasts/regional and
// POST /admin/broadcasts/individual (prisma.broadcast.create, no select).

export class BroadcastDto {
  @ApiProperty({ example: 'broadcast-uuid-1' })
  id: string;

  @ApiProperty({ example: 'BR-123456-Regional' })
  reference: string;

  @ApiProperty({ enum: BROADCAST_TYPE_VALUES, example: 'REGIONAL' })
  type: BroadcastType;

  @ApiProperty({
    example: 'New stock of Viju Chocolate is available from Monday',
  })
  message: string;

  @ApiProperty({
    enum: REGION_VALUES,
    isArray: true,
    example: ['LAGOS', 'WESTERN'],
  })
  targetRegions: Region[];

  @ApiProperty({ example: 'customer-uuid-1', nullable: true })
  targetCustomerId: string | null;

  @ApiProperty({
    example: 80000,
    nullable: true,
    description: 'Delivery allowance credited (individual broadcasts only)',
  })
  deliveryAllowance: number | null;

  @ApiProperty({ example: 'payment-uuid-1', nullable: true })
  allowancePaymentId: string | null;

  @ApiProperty({ example: 'staff-uuid-1' })
  sentById: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  sentAt: Date;

  @ApiProperty({ example: 42, description: 'Number of recipients notified' })
  deliveredCount: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

// ─── Relations included by history + detail ────────────────

export class BroadcastSentByDto {
  @ApiProperty({ example: 'Jane Admin' })
  name: string;

  @ApiProperty({ example: 'jane@viju.example' })
  email: string;
}

export class BroadcastTargetCustomerDto {
  @ApiProperty({ example: 'customer-uuid-1' })
  id: string;

  @ApiProperty({ example: 'Acme Corp' })
  name: string;
}

// ─── Allowance payment (full Payment row, detail only) ─────

export class BroadcastAllowancePaymentDto {
  @ApiProperty({ example: 'payment-uuid-1' })
  id: string;

  @ApiProperty({ example: 'ERP-PMT-001', nullable: true })
  erpId: string | null;

  @ApiProperty({ example: 'customer-uuid-1' })
  customerId: string;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  date: Date;

  @ApiProperty({ example: 80000 })
  amount: number;

  @ApiProperty({ example: 'Delivery Allowance', nullable: true })
  reference: string | null;

  @ApiProperty({
    example: 1250000,
    description: 'Wallet balance after payment',
  })
  runningBalance: number;

  @ApiProperty({ example: '2026-06-09T08:16:56.533Z', format: 'date-time' })
  createdAt: Date;
}

// ─── History list item (GET /admin/broadcasts/history) ─────

export class BroadcastHistoryItemDto extends BroadcastDto {
  @ApiProperty({ type: BroadcastSentByDto })
  sentBy: BroadcastSentByDto;

  @ApiProperty({ type: BroadcastTargetCustomerDto, nullable: true })
  targetCustomer: BroadcastTargetCustomerDto | null;
}

export class PaginatedBroadcastHistoryResponseDto {
  @ApiProperty({ type: [BroadcastHistoryItemDto] })
  data: BroadcastHistoryItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

// ─── Detail (GET /admin/broadcasts/:id) ────────────────────

export class BroadcastDetailDto extends BroadcastDto {
  @ApiProperty({ type: BroadcastSentByDto })
  sentBy: BroadcastSentByDto;

  @ApiProperty({ type: BroadcastTargetCustomerDto, nullable: true })
  targetCustomer: BroadcastTargetCustomerDto | null;

  @ApiProperty({ type: BroadcastAllowancePaymentDto, nullable: true })
  allowancePayment: BroadcastAllowancePaymentDto | null;
}
