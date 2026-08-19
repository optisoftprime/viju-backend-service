import { IsString, IsNotEmpty, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A message must carry text, an attachment, or both — it just can't be empty.
 * Each field is required only when the other is absent, so attachment-only
 * and text-only messages are both valid (WhatsApp-style).
 */
export class SendMessageDto {
  @ApiPropertyOptional({
    description: 'Message text. Optional when an attachmentUrl is provided.',
  })
  @ValidateIf((o) => !o.attachmentUrl)
  @IsString()
  @IsNotEmpty({ message: 'Provide content or an attachmentUrl.' })
  content?: string;

  @ApiPropertyOptional({
    description: 'Attachment URL. Optional when content is provided.',
  })
  @ValidateIf((o) => !o.content)
  @IsString()
  @IsNotEmpty({ message: 'Provide content or an attachmentUrl.' })
  attachmentUrl?: string;
}
