import { BadRequestException, HttpStatus } from '@nestjs/common';

/**
 * PR-1 — is this URL one that POST /uploads produced?
 *
 * A profile picture is rendered in an `<img>` for every viewer of that user.
 * Accepting an arbitrary URL would turn the field into a tracking beacon (the
 * host learns every viewer's IP and user-agent) and, on any surface that
 * fetches it server-side, an SSRF vector. So the value is only accepted when
 * it points at storage this project actually writes to.
 *
 * The allow-list is derived from configuration rather than hard-coded, so it
 * follows the deployment instead of needing an edit per environment:
 *
 *   • Cloudinary  — `res.cloudinary.com`, when CLOUDINARY_* is configured.
 *   • Local disk  — whatever UPLOAD_PUBLIC_BASE / PUBLIC_BASE_URL / APP_URL
 *                   resolves to, which is what StorageService returns.
 *   • Relative    — `/uploads/...`, the same-origin form the local driver
 *                   returns when no public base is set.
 *
 * UPLOAD_URL_ALLOWED_HOSTS (comma-separated) extends it, for a CDN in front of
 * the bucket.
 */

/** Hosts that are always acceptable when the matching provider is in use. */
const CLOUDINARY_HOST = 'res.cloudinary.com';

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Every host a stored upload may legitimately live on, for this deployment. */
export function allowedUploadHosts(): string[] {
  const hosts = new Set<string>();

  // Cloudinary is in play whenever it is configured, regardless of whether it
  // is the ACTIVE provider — a URL stored while it was active must keep
  // working after a switch to local disk.
  if (
    process.env.CLOUDINARY_URL ||
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.STORAGE_PROVIDER === 'cloudinary'
  ) {
    hosts.add(CLOUDINARY_HOST);
  }

  for (const candidate of [
    process.env.UPLOAD_PUBLIC_BASE,
    process.env.PUBLIC_BASE_URL,
    process.env.APP_URL,
  ]) {
    const host = hostOf(candidate);
    if (host) hosts.add(host);
  }

  for (const extra of (process.env.UPLOAD_URL_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)) {
    hosts.add(extra);
  }

  return [...hosts];
}

/**
 * Validates a stored-upload URL, or throws 400 `INVALID_UPLOAD_URL`.
 *
 * `null` is returned unchanged — clearing a picture is a legitimate save.
 */
export function assertUploadUrl(
  value: string | null | undefined,
  field = 'profilePhotoUrl',
): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;

  // The same-origin relative form the local driver returns. No host to check,
  // and it cannot point anywhere else.
  if (trimmed.startsWith('/uploads/')) return trimmed;

  const refuse = (why: string): never => {
    throw new BadRequestException({
      message: why,
      code: 'INVALID_UPLOAD_URL',
      field,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return refuse('That is not a valid URL.');
  }

  // http: would also downgrade every viewer's connection.
  if (parsed.protocol !== 'https:') {
    return refuse('The image URL must be https.');
  }

  const allowed = allowedUploadHosts();
  if (!allowed.includes(parsed.host.toLowerCase())) {
    return refuse(
      'That image is not hosted on this service. Upload it through ' +
        'POST /uploads first and send the URL that returns.',
    );
  }

  return trimmed;
}
