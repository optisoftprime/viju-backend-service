import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { assertUploadUrl } from '../../common/uploads/upload-url';
import {
  detectImageFormat,
  isAcceptedImage,
} from '../../common/uploads/image-signature';

/**
 * Spec 42 — profile self-service (PR-1, PR-2) and the upload signature check
 * (PR-3).
 *
 * These pin the SAFETY properties rather than the happy paths: that a photo
 * URL cannot point at someone else's host, that a password cannot be changed
 * without proving knowledge of the current one, and that a renamed file cannot
 * reach storage.
 */
describe('Profile self-service and upload safety (spec 42)', () => {
  const codeOf = (e: unknown): string | undefined => {
    const body = (e as { response?: Record<string, unknown> })?.response;
    return typeof body?.code === 'string' ? body.code : undefined;
  };

  const codeFrom = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return codeOf(e) ?? 'NO_CODE';
    }
    throw new Error('expected the call to be refused, but it resolved');
  };

  describe('PR-1 — the photo URL allow-list', () => {
    const ORIGINAL = process.env;
    beforeEach(() => {
      process.env = { ...ORIGINAL, CLOUDINARY_CLOUD_NAME: 'demo' };
      delete process.env.UPLOAD_PUBLIC_BASE;
      delete process.env.PUBLIC_BASE_URL;
      delete process.env.APP_URL;
      delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
    });
    afterAll(() => {
      process.env = ORIGINAL;
    });

    it('accepts a URL from the configured upload host', () => {
      const url =
        'https://res.cloudinary.com/demo/image/upload/v1/viju/profile-photos/a.png';
      expect(assertUploadUrl(url)).toBe(url);
    });

    it('accepts the same-origin relative form the local driver returns', () => {
      expect(assertUploadUrl('/uploads/profile-photos/a.png')).toBe(
        '/uploads/profile-photos/a.png',
      );
    });

    it('refuses an arbitrary host', () => {
      // The field is rendered in an <img> for every viewer of that user, so
      // an attacker-controlled host learns each viewer's IP and user-agent.
      expect(() => assertUploadUrl('https://evil.example/track.png')).toThrow(
        BadRequestException,
      );
    });

    it('refuses http, which would downgrade every viewer’s connection', () => {
      expect(() =>
        assertUploadUrl('http://res.cloudinary.com/demo/a.png'),
      ).toThrow(BadRequestException);
    });

    it('refuses a value that is not a URL at all', () => {
      expect(() => assertUploadUrl('javascript:alert(1)')).toThrow(
        BadRequestException,
      );
      expect(() => assertUploadUrl('not a url')).toThrow(BadRequestException);
    });

    it('treats null and empty string as "clear the picture"', () => {
      expect(assertUploadUrl(null)).toBeNull();
      expect(assertUploadUrl('')).toBeNull();
      expect(assertUploadUrl('   ')).toBeNull();
    });

    it('honours an explicitly configured extra host', () => {
      process.env.UPLOAD_URL_ALLOWED_HOSTS = 'cdn.viju.example';
      const url = 'https://cdn.viju.example/profile-photos/a.png';
      expect(assertUploadUrl(url)).toBe(url);
    });
  });

  describe('PR-2 — changing your own password', () => {
    const CURRENT = 'CurrentPass123';

    const build = async (opts: { password?: string | null } = {}) => {
      const hash =
        opts.password === null ? null : await bcrypt.hash(CURRENT, 10);
      const service = Object.create(UsersService.prototype) as UsersService;
      const staff = {
        findUnique: jest.fn().mockResolvedValue({ id: 's-1', password: hash }),
        update: jest.fn().mockResolvedValue({}),
      };
      (service as unknown as { prisma: unknown }).prisma = { staff };
      return { service, staff };
    };

    it('refuses a wrong current password before writing anything', async () => {
      const { service, staff } = await build();

      const code = await codeFrom(() =>
        service.changeMyPassword(
          { id: 's-1', role: 'OFFICER' },
          'WrongPassword1',
          'BrandNewPass1',
        ),
      );

      expect(code).toBe('INVALID_CURRENT_PASSWORD');
      // The whole point: nothing is written on a failed proof.
      expect(staff.update).not.toHaveBeenCalled();
    });

    it('refuses re-using the current password', async () => {
      const { service, staff } = await build();

      const code = await codeFrom(() =>
        service.changeMyPassword(
          { id: 's-1', role: 'OFFICER' },
          CURRENT,
          CURRENT,
        ),
      );

      expect(code).toBe('PASSWORD_REUSED');
      expect(staff.update).not.toHaveBeenCalled();
    });

    it('refuses an account that has no local password', async () => {
      const { service } = await build({ password: null });

      const code = await codeFrom(() =>
        service.changeMyPassword(
          { id: 's-1', role: 'OFFICER' },
          'anything',
          'BrandNewPass1',
        ),
      );

      expect(code).toBe('NO_PASSWORD_SET');
    });

    it('stores a HASH, never the submitted password', async () => {
      const { service, staff } = await build();

      const result = await service.changeMyPassword(
        { id: 's-1', role: 'OFFICER' },
        CURRENT,
        'BrandNewPass1',
      );

      expect(result).toEqual({ success: true, message: 'Password changed' });
      const written = staff.update.mock.calls[0][0].data.password as string;
      expect(written).not.toBe('BrandNewPass1');
      await expect(bcrypt.compare('BrandNewPass1', written)).resolves.toBe(
        true,
      );
    });

    it('does not touch refresh tokens — sessions survive', async () => {
      // Stated rather than assumed: the frontend needs to know whether to warn
      // the user that they will be signed out elsewhere. They will not be.
      const { service, staff } = await build();

      await service.changeMyPassword(
        { id: 's-1', role: 'OFFICER' },
        CURRENT,
        'BrandNewPass1',
      );

      // `prisma` carries only `staff` — a refreshToken deleteMany would throw.
      expect(staff.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('PR-3 — the image magic-number check', () => {
    const withHeader = (bytes: number[], length = 32): Buffer => {
      const buf = Buffer.alloc(length);
      Buffer.from(bytes).copy(buf);
      return buf;
    };

    it('recognises the four accepted containers', () => {
      expect(detectImageFormat(withHeader([0xff, 0xd8, 0xff, 0xe0]))).toBe(
        'JPEG',
      );
      expect(
        detectImageFormat(
          withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      ).toBe('PNG');

      const webp = Buffer.alloc(32);
      webp.write('RIFF', 0, 'ascii');
      webp.write('WEBP', 8, 'ascii');
      expect(detectImageFormat(webp)).toBe('WEBP');

      const avif = Buffer.alloc(32);
      avif.write('ftyp', 4, 'ascii');
      avif.write('avif', 8, 'ascii');
      expect(detectImageFormat(avif)).toBe('AVIF');
    });

    it('refuses a PDF renamed to .png', () => {
      // %PDF- — the case the MIME check cannot catch, because `mimetype` is
      // supplied by the client.
      expect(isAcceptedImage(withHeader([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
        false,
      );
    });

    it('refuses an SVG, which can carry a script', () => {
      expect(isAcceptedImage(Buffer.from('<svg xmlns="http://..."'))).toBe(
        false,
      );
    });

    it('refuses HTML and an empty buffer', () => {
      expect(isAcceptedImage(Buffer.from('<!DOCTYPE html>'))).toBe(false);
      expect(isAcceptedImage(Buffer.alloc(0))).toBe(false);
    });

    it('refuses an MP4, which shares AVIF’s container', () => {
      // Same ISO-BMFF `ftyp` box; only the brand separates them, so a check
      // on `ftyp` alone would let video through.
      const mp4 = Buffer.alloc(32);
      mp4.write('ftyp', 4, 'ascii');
      mp4.write('isom', 8, 'ascii');
      expect(isAcceptedImage(mp4)).toBe(false);
    });

    it('refuses a RIFF container that is not WEBP', () => {
      const wav = Buffer.alloc(32);
      wav.write('RIFF', 0, 'ascii');
      wav.write('WAVE', 8, 'ascii');
      expect(isAcceptedImage(wav)).toBe(false);
    });
  });
});
