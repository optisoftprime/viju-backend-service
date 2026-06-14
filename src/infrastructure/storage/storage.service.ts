import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folder?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  size: number;
  mimeType: string;
}

export abstract class StorageService {
  abstract upload(input: UploadInput): Promise<UploadResult>;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class LocalStorageService extends StorageService {
  private readonly logger = new Logger('LocalStorageService');
  private readonly root = process.env.UPLOAD_DIR || 'uploads';
  private readonly publicBase = LocalStorageService.resolvePublicBase();

  /**
   * Base the returned file URL is built on. Prefers an absolute, publicly
   * reachable URL so clients can open the file directly:
   *   1. UPLOAD_PUBLIC_BASE — explicit (e.g. https://cdn.example/uploads)
   *   2. PUBLIC_BASE_URL / APP_URL — the API's public origin + /uploads
   *   3. '/uploads' — same-origin relative fallback (served statically)
   */
  private static resolvePublicBase(): string {
    const strip = (s: string) => s.replace(/\/+$/, '');
    if (process.env.UPLOAD_PUBLIC_BASE) {
      return strip(process.env.UPLOAD_PUBLIC_BASE);
    }
    const origin = process.env.PUBLIC_BASE_URL || process.env.APP_URL;
    if (origin) return `${strip(origin)}/uploads`;
    return '/uploads';
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const folder = input.folder ?? 'misc';
    const ext = path.extname(input.originalName) || '';
    const key = `${folder}/${randomUUID()}${ext}`;
    const full = path.join(this.root, key);

    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.buffer);

    this.logger.log(`[storage] uploaded ${key} (${input.buffer.length} bytes)`);

    return {
      url: `${this.publicBase}/${key}`,
      key,
      size: input.buffer.length,
      mimeType: input.mimeType,
    };
  }

  async delete(key: string): Promise<void> {
    const full = path.join(this.root, key);
    await fs.unlink(full).catch(() => {
      this.logger.warn(`[storage] delete miss: ${key}`);
    });
  }
}
