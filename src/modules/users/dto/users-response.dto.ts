import { ApiProperty } from '@nestjs/swagger';
import { Region, REGION_VALUES } from '../../../common/region/region.constants';

const ROLE_VALUES = [
  'CUSTOMER',
  'ADMIN',
  'OFFICER',
  'REGIONAL_ADMIN',
  'LOADING_OFFICER',
  'WAREHOUSE_OFFICER',
] as const;
type UserRole = (typeof ROLE_VALUES)[number];

/**
 * The signed-in principal, for GET /users/me.
 *
 * One shape for staff and customers: `region` is the field the web portal
 * needs most (RA-03) — the regional dashboard, the officers list and the
 * sidebar badge all read it instead of hardcoding a region.
 */
export class CurrentUserDto {
  @ApiProperty({ example: 'stf_5' })
  id: string;

  @ApiProperty({ example: 'Chidi Eze' })
  name: string;

  @ApiProperty({
    enum: ROLE_VALUES,
    example: 'REGIONAL_ADMIN',
    description: "Always 'CUSTOMER' for customers; the StaffRole for staff.",
  })
  role: UserRole;

  @ApiProperty({
    enum: ['CUSTOMER', 'STAFF'],
    example: 'STAFF',
    description: 'Which principal table this user came from.',
  })
  type: 'CUSTOMER' | 'STAFF';

  @ApiProperty({ example: 'c.eze@viju.com', nullable: true })
  email: string | null;

  @ApiProperty({ example: '+2348012345678', nullable: true })
  phone: string | null;

  @ApiProperty({
    enum: REGION_VALUES,
    example: 'EASTERN',
    nullable: true,
    description:
      'Region this account is scoped to. Null for org-wide ADMIN. Every ' +
      'region-scoped endpoint derives its filter from this value, never from ' +
      'a client-supplied query param.',
  })
  region: Region | null;

  @ApiProperty({
    example: true,
    description:
      'Staff only — false once deactivated. Always true for customers.',
  })
  isActive: boolean;

  @ApiProperty({
    example: '2026-08-19T07:41:00.000Z',
    format: 'date-time',
    nullable: true,
    description:
      'Staff only — most recent successful login. Null for customers and for ' +
      'staff who have never logged in.',
  })
  lastLoginAt: Date | null;

  @ApiProperty({
    example: 'https://cdn.viju.example/photos/abc.jpg',
    nullable: true,
    description: 'Customer only — profile photo. Always null for staff.',
  })
  profilePhotoUrl: string | null;
}
