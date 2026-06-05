import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { UploadFileDto, UploadFolder } from './dto/upload.dto';

interface UploadedFileShape {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Per-folder rules. `mime` is a list of allowed MIME prefixes (matched
 * with `startsWith`) so e.g. `image/` covers any image subtype.
 * `maxBytes` caps the file size.
 *
 * PRD references:
 *   - Chat (F6 AC4):    one image per message, max 5 MB
 *   - Waybill (F13 AC3): warehouse officer uploads PDF/JPG/PNG up to 10 MB
 *   - Tickets (F7 AC1): optional image attachment
 *   - Flyer (F19 AC2):  image only (any reasonable size)
 *   - Profile (F8 AC4): image only
 */
const FOLDER_RULES: Record<UploadFolder, { mime: string[]; maxBytes: number }> =
  {
    [UploadFolder.PROFILE_PHOTOS]: {
      mime: ['image/'],
      maxBytes: 5 * 1024 * 1024,
    },
    [UploadFolder.CHAT_ATTACHMENTS]: {
      mime: ['image/'],
      maxBytes: 5 * 1024 * 1024,
    },
    [UploadFolder.TICKET_ATTACHMENTS]: {
      mime: ['image/'],
      maxBytes: 5 * 1024 * 1024,
    },
    [UploadFolder.WAYBILL_DOCUMENTS]: {
      mime: ['image/', 'application/pdf'],
      maxBytes: 10 * 1024 * 1024,
    },
    [UploadFolder.PRODUCT_FLYERS]: {
      mime: ['image/'],
      maxBytes: 10 * 1024 * 1024,
    },
    [UploadFolder.MISC]: {
      mime: ['image/', 'application/pdf'],
      maxBytes: 10 * 1024 * 1024,
    },
  };

@ApiTags('File Uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @ApiOperation({
    summary: 'Upload a single file to the configured storage backend',
    description:
      'Multipart upload. Pass `folder` as a query param OR form field. ' +
      'Cloudinary is used when CLOUDINARY_* env vars are present; ' +
      'otherwise the file is saved to local disk and a /uploads/... URL ' +
      'is returned. The endpoint never throws because of storage outage — ' +
      'a placeholder URL is returned and the failure is logged so the FE ' +
      'flow keeps moving.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'folder'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: {
          type: 'string',
          enum: Object.values(UploadFolder),
          description: 'Destination folder (see UploadFolder enum)',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Query() query: UploadFileDto,
    @UploadedFile() file: UploadedFileShape | undefined,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Send the binary in a "file" multipart field.',
      );
    }

    const rules = FOLDER_RULES[query.folder];
    if (file.size > rules.maxBytes) {
      throw new BadRequestException(
        `File too large for folder "${query.folder}". Max ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`,
      );
    }
    const mimeOk = rules.mime.some((prefix) =>
      file.mimetype.startsWith(prefix),
    );
    if (!mimeOk) {
      throw new BadRequestException(
        `MIME type "${file.mimetype}" not allowed for folder "${query.folder}". Allowed: ${rules.mime.join(', ')}`,
      );
    }

    return this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: query.folder,
    });
  }
}
