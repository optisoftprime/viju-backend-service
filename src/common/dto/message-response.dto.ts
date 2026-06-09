import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard `{ message }` acknowledgement returned by mutating endpoints
 * that don't echo back a resource.
 */
export class MessageResponseDto {
  @ApiProperty({ example: 'Operation completed successfully' })
  message: string;
}
