import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of a successful single-file upload. Mirrors the `UploadResult`
 * shape returned by every `StorageService` implementation
 * (local disk + Cloudinary).
 *
 * When storage credentials are missing the backend fails soft and returns
 * a synthetic `placeholder://...` URL/key (still this same shape) so the
 * FE upload flow keeps working — see UploadsController docs.
 */
export class UploadResponseDto {
  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/viju/profile-photos/abc123.jpg',
    description:
      'Publicly reachable URL of the stored file. Cloudinary `secure_url`, ' +
      'a `/uploads/...` path for local disk, or a `placeholder://...` URL ' +
      'when storage is misconfigured.',
  })
  url: string;

  @ApiProperty({
    example: 'viju/profile-photos/abc123',
    description:
      'Stable storage key used to reference/delete the file later ' +
      '(Cloudinary `public_id` or the local-disk relative path).',
  })
  key: string;

  @ApiProperty({ example: 204800, description: 'Stored file size in bytes' })
  size: number;

  @ApiProperty({
    example: 'image/jpeg',
    description: 'MIME type of the uploaded file, as detected on the request.',
  })
  mimeType: string;
}
