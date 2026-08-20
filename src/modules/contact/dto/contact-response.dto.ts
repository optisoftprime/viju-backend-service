import { ApiProperty } from '@nestjs/swagger';

/** Acknowledgement returned by POST /contact. */
export class ContactMessageResponseDto {
  @ApiProperty({
    example: "Thanks for reaching out. We'll get back to you within 24 hours.",
  })
  message: string;
}
