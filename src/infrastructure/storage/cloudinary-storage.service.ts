import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { StorageService, UploadInput, UploadResult } from './storage.service';

/**
 * Cloudinary-backed StorageService.
 *
 * Required env (any one of):
 *   CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
 * OR
 *   CLOUDINARY_CLOUD_NAME=...
 *   CLOUDINARY_API_KEY=...
 *   CLOUDINARY_API_SECRET=...
 *
 * Missing creds fail soft — onModuleInit logs a warning, every upload
 * call returns a synthetic local-style placeholder instead of throwing.
 * The app NEVER crashes because of storage misconfiguration.
 */
@Injectable()
export class CloudinaryStorageService
  extends StorageService
  implements OnModuleInit
{
  private readonly logger = new Logger('CloudinaryStorage');
  private ready = false;

  onModuleInit() {
    try {
      const url = process.env.CLOUDINARY_URL;
      const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
      const api_key = process.env.CLOUDINARY_API_KEY;
      const api_secret = process.env.CLOUDINARY_API_SECRET;

      if (!url && (!cloud_name || !api_key || !api_secret)) {
        this.logger.warn(
          '⚠️ STORAGE_PROVIDER=cloudinary but credentials are missing. ' +
            'Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET. ' +
            'Uploads will return a placeholder response without persisting.',
        );
        return;
      }

      if (url) {
        cloudinary.config({ secure: true });
      } else {
        cloudinary.config({
          cloud_name,
          api_key,
          api_secret,
          secure: true,
        });
      }

      this.ready = true;
      this.logger.log(
        `Cloudinary ready (cloud: ${cloud_name ?? '(from CLOUDINARY_URL)'})`,
      );
    } catch (e) {
      this.logger.error(
        `Cloudinary init failed: ${(e as Error).message}. ` +
          'Uploads will return placeholders.',
      );
      this.ready = false;
    }
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    if (!this.ready) {
      this.logger.warn(
        `[storage-fallback] would upload ${input.originalName} (${input.buffer.length} bytes) to ${input.folder ?? 'misc'} — returning placeholder`,
      );
      return {
        url: `placeholder://${input.folder ?? 'misc'}/${input.originalName}`,
        key: `placeholder/${input.folder ?? 'misc'}/${input.originalName}`,
        size: input.buffer.length,
        mimeType: input.mimeType,
      };
    }

    try {
      const folder = input.folder ?? 'misc';
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `viju/${folder}`,
            resource_type: 'auto',
            // Don't trust client-provided filename for the public_id;
            // Cloudinary generates a stable random one.
          },
          (err, res) => {
            if (err || !res) {
              return reject(
                err instanceof Error
                  ? err
                  : new Error(
                      err
                        ? ((err as { message?: string }).message ??
                            'Cloudinary upload failed')
                        : 'No response from Cloudinary',
                    ),
              );
            }
            resolve(res);
          },
        );
        stream.end(input.buffer);
      });

      return {
        url: result.secure_url,
        key: result.public_id,
        size: result.bytes,
        mimeType: input.mimeType,
      };
    } catch (e) {
      this.logger.error(
        `Cloudinary upload threw for ${input.originalName}: ${(e as Error).message}`,
      );
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.ready) {
      this.logger.warn(`[storage-fallback] skip delete ${key}`);
      return;
    }
    try {
      await cloudinary.uploader.destroy(key);
    } catch (e) {
      this.logger.warn(
        `Cloudinary delete failed for ${key}: ${(e as Error).message}`,
      );
    }
  }
}
