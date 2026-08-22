import { ApiProperty } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';

const STAFF_ROLE_VALUES = Object.values(StaffRole);

/**
 * S-1 - the author of a staff-written ticket reply or chat message.
 *
 * `role` is the wire enum, not display text: the client maps it to a label,
 * so this API never dictates the wording shown in a thread.
 */
export class StaffSenderDto {
  @ApiProperty({ example: '1a55b0c9-4d3e-4f10-8b22-9c1d2e3f4a55' })
  id: string;

  @ApiProperty({ example: 'Chidi Nwosu' })
  name: string;

  @ApiProperty({
    enum: STAFF_ROLE_VALUES,
    example: StaffRole.REGIONAL_ADMIN,
    description:
      'The wire enum for the sender role. Map it to a label on the client.',
  })
  role: StaffRole;
}
