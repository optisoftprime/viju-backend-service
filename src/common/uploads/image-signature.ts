/**
 * PR-3 — is this buffer actually one of the image formats we accept?
 *
 * WHY THE HEADER AND NOT THE MIME TYPE: `Content-Type` on a multipart part is
 * supplied by the client, and the filename is just a string. Both are trivially
 * set to `image/png` on a PDF, an HTML file or an SVG carrying a script — which
 * then reaches storage and is served back to every viewer of that profile. The
 * only thing that cannot be renamed is the file's own first bytes.
 *
 * The frontend already checks this before uploading. That is a good usability
 * guard — it fails fast and explains itself — but it is not a control, because
 * anything client-side can be bypassed by calling POST /uploads directly. This
 * is the control.
 *
 * Deliberately NOT applied to every folder: `waybill-documents` legitimately
 * accepts PDFs, so the caller decides which rule to apply.
 */

/** The image containers a profile photo, flyer or attachment may be in. */
export const ACCEPTED_IMAGE_FORMATS = ['JPEG', 'PNG', 'WEBP', 'AVIF'] as const;
export type AcceptedImageFormat = (typeof ACCEPTED_IMAGE_FORMATS)[number];

const startsWith = (buffer: Buffer, bytes: number[]): boolean =>
  buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte);

/** ASCII at a byte offset, for the container formats that use a 4-char tag. */
const tagAt = (buffer: Buffer, offset: number): string =>
  buffer.length >= offset + 4
    ? buffer.toString('ascii', offset, offset + 4)
    : '';

/**
 * The format this buffer really is, or null when it is none of them.
 *
 * Each check is the container's own signature:
 *   JPEG  FF D8 FF                          at 0
 *   PNG   89 50 4E 47 0D 0A 1A 0A           at 0
 *   WEBP  "RIFF" at 0 and "WEBP" at 8       (RIFF is a family; the brand at 8
 *                                            is what makes it an image)
 *   AVIF  "ftyp" at 4, brand avif|avis at 8 (ISO-BMFF, same family as MP4 —
 *                                            the brand is what separates them)
 */
export function detectImageFormat(buffer: Buffer): AcceptedImageFormat | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'JPEG';

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'PNG';
  }

  if (tagAt(buffer, 0) === 'RIFF' && tagAt(buffer, 8) === 'WEBP') {
    return 'WEBP';
  }

  if (tagAt(buffer, 4) === 'ftyp') {
    const brand = tagAt(buffer, 8).toLowerCase();
    // `avis` is the image-sequence brand; both are AVIF as far as an <img> is
    // concerned. An `mp4 ` or `isom` brand deliberately falls through.
    if (brand === 'avif' || brand === 'avis') return 'AVIF';
  }

  return null;
}

/** True when the buffer is one of the accepted image containers. */
export function isAcceptedImage(buffer: Buffer): boolean {
  return detectImageFormat(buffer) !== null;
}
