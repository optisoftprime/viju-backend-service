import {
  IsOptional,
  IsString,
  IsNotEmpty,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * PR-1 — body for PATCH /users/profile/photo.
 *
 * Upload through `POST /uploads?folder=profile-photos` first and send the URL
 * that returns. The URL is validated against this deployment's own upload
 * hosts; an arbitrary one is refused with 400 `INVALID_UPLOAD_URL`.
 */
export class UpdateMyPhotoDto {
  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v1/viju/profile-photos/ada.png',
    nullable: true,
    description:
      'The uploaded image URL, or `null` to clear the picture. An empty ' +
      'string clears it too. Must be a URL this service produced.',
  })
  @IsOptional()
  // `null` is a legitimate value (clear the picture), so it is allowed
  // through while any non-null value must still be a string.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  profilePhotoUrl: string | null;
}

/**
 * PR-2 — body for PATCH /users/profile/password.
 *
 * `confirmNewPassword` is deliberately NOT part of this contract. Its only job
 * is catching a typo in the form, and the server has no use for a second copy
 * of a value it already has — accepting it would imply it was checked.
 */
export class ChangeMyPasswordDto {
  @ApiProperty({
    description:
      'The password currently on the account. Compared against the stored ' +
      'hash before anything is written — a mismatch is 400 ' +
      '`INVALID_CURRENT_PASSWORD`.',
  })
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  currentPassword: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    description:
      'The replacement. Same rules as POST /admin/officers (8–72 ' +
      'characters). Re-using the current password is 400 `PASSWORD_REUSED`.',
  })
  @IsString()
  @IsNotEmpty({ message: 'newPassword is required' })
  @MinLength(8)
  // bcrypt silently ignores bytes past 72; refuse rather than truncate.
  @MaxLength(72)
  newPassword: string;
}
