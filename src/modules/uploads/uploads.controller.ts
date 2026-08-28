import {
  BadRequestException,
  Controller,
  HttpStatus,
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
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { UploadFileDto, UploadFolder } from './dto/upload.dto';
import { UploadResponseDto } from './dto/uploads-response.dto';
import {
  ACCEPTED_IMAGE_FORMATS,
  isAcceptedImage,
} from '../../common/uploads/image-signature';

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
const FOLDER_RULES: Record<
  UploadFolder,
  { mime: string[]; maxBytes: number; imagesOnly: boolean }
> = {
  [UploadFolder.PROFILE_PHOTOS]: {
    mime: ['image/'],
    maxBytes: 5 * 1024 * 1024,
    imagesOnly: true,
  },
  [UploadFolder.CHAT_ATTACHMENTS]: {
    mime: ['image/'],
    maxBytes: 5 * 1024 * 1024,
    imagesOnly: true,
  },
  [UploadFolder.TICKET_ATTACHMENTS]: {
    mime: ['image/'],
    maxBytes: 5 * 1024 * 1024,
    imagesOnly: true,
  },
  // PR-3: PDFs are the point of this folder, so the image signature check
  // does not apply — the MIME rule above still does.
  [UploadFolder.WAYBILL_DOCUMENTS]: {
    mime: ['image/', 'application/pdf'],
    maxBytes: 10 * 1024 * 1024,
    imagesOnly: false,
  },
  [UploadFolder.PRODUCT_FLYERS]: {
    mime: ['image/'],
    maxBytes: 10 * 1024 * 1024,
    imagesOnly: true,
  },
  [UploadFolder.MISC]: {
    mime: ['image/', 'application/pdf'],
    maxBytes: 10 * 1024 * 1024,
    imagesOnly: false,
  },
};

/**
 * CC-01: uploads are authenticated. Any signed-in principal (customer or
 * staff) may upload, but an anonymous caller may not — an open endpoint here
 * would let anyone write into the project's storage bucket.
 */
@ApiTags('File Uploads')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
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
  @ApiCreatedResponse({
    description:
      'File stored successfully; returns the public URL + storage key.',
    type: UploadResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'No file supplied, file larger than the folder allows, or a MIME type ' +
      'the folder does not accept.',
  })
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

    // PR-3 — the real control. Everything above this line trusts the client:
    // `mimetype` comes off the multipart part and the filename is just a
    // string, so a renamed PDF or an SVG carrying a script passes both and is
    // then served back to every viewer of that profile. The file's own first
    // bytes are the one thing that cannot be renamed.
    //
    // Applied only to IMAGE-ONLY folders. `waybill-documents` and `misc`
    // legitimately accept PDFs, so they keep the MIME rule above rather than
    // having one rule forced on every folder.
    if (rules.imagesOnly && !isAcceptedImage(file.buffer)) {
      throw new BadRequestException({
        message: `That file is not a ${ACCEPTED_IMAGE_FORMATS.join(', ').replace(/, ([^,]*)$/, ' or $1')} image.`,
        code: 'UNSUPPORTED_IMAGE_TYPE',
        statusCode: HttpStatus.BAD_REQUEST,
      });
    }

    return this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: query.folder,
    });
  }
}
