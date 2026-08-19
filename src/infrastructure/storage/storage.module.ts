import { Module } from '@nestjs/common';
import { LocalStorageService, StorageService } from './storage.service';
import { CloudinaryStorageService } from './cloudinary-storage.service';

/**
 * Pick the storage backend from env (mirrors the .env.example doc):
 *   STORAGE_PROVIDER=cloudinary → Cloudinary (returns a public secure_url)
 *   STORAGE_PROVIDER=local      → local disk (served at <origin>/uploads/*)
 *   unset                       → auto: Cloudinary if creds present, else local
 */
function resolveStorageClass() {
  const provider = (process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (provider === 'cloudinary') return CloudinaryStorageService;
  if (provider === 'local') return LocalStorageService;

  const hasCloudinaryCreds =
    !!process.env.CLOUDINARY_URL ||
    !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );
  return hasCloudinaryCreds ? CloudinaryStorageService : LocalStorageService;
}

@Module({
  providers: [
    {
      provide: StorageService,
      useClass: resolveStorageClass(),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
