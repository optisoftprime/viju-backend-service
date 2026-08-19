import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

/**
 * Logical destinations the FE can target. Each folder maps to a
 * different Cloudinary subfolder (viju/<folder>) and has its own
 * MIME/size rules enforced by the controller.
 */
export enum UploadFolder {
  PROFILE_PHOTOS = 'profile-photos',
  CHAT_ATTACHMENTS = 'chat-attachments',
  TICKET_ATTACHMENTS = 'ticket-attachments',
  WAYBILL_DOCUMENTS = 'waybill-documents',
  PRODUCT_FLYERS = 'product-flyers',
  MISC = 'misc',
}

export class UploadFileDto {
  @ApiProperty({
    enum: UploadFolder,
    enumName: 'UploadFolder',
    description:
      'Logical bucket the file belongs to. Each maps to a different ' +
      'Cloudinary subfolder + has its own MIME/size restrictions.',
  })
  @IsEnum(UploadFolder)
  folder!: UploadFolder;
}
