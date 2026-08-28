import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { Region } from './region.constants';

/**
 * The region rules a REGIONAL_ADMIN is held to, in one place.
 *
 * Spec 40 gives a regional admin the same screens an admin has, each scoped to
 * their own region. Every one of those routes needs the same two decisions —
 * "what is their region?" and "may they touch this?" — so they are answered
 * here rather than re-derived per controller, where they could drift apart.
 *
 * The scoping rule is the one the audit routes already established (RA-T2):
 * the region comes from the TOKEN and OVERRIDES anything the client sent,
 * rather than being honoured or rejected. That way the frontend never has to
 * know which of the two it is, and a hand-built request cannot widen its own
 * scope.
 *
 * WRITES are stricter than reads. A read that names another region is
 * harmless once overridden — the caller simply gets their own data. A WRITE
 * that names another region is refused outright with `REGION_NOT_ALLOWED`,
 * because silently narrowing it would tell an admin they had broadcast to
 * three regions when they reached one.
 */

/** The staff shape these helpers read. Matches what the JWT strategy returns. */
export interface RegionScopedActor {
  role: string;
  region?: Region | null;
}

/** True for the one role these rules apply to. */
export function isRegionalAdmin(user: RegionScopedActor): boolean {
  return user.role === 'REGIONAL_ADMIN';
}

/**
 * The regional admin's own region, or a 403 when their record carries none.
 *
 * An unconfigured account cannot be scoped, and returning `undefined` would
 * hand them every region at once — so it is refused rather than widened. The
 * frontend already renders `REGION_NOT_SET` as an account-configuration
 * problem rather than an empty result.
 */
export function requireOwnRegion(user: RegionScopedActor): Region {
  if (!user.region) {
    throw new ForbiddenException({
      message: 'No region is set on your account. Contact an administrator.',
      code: 'REGION_NOT_SET',
      statusCode: HttpStatus.FORBIDDEN,
    });
  }
  return user.region;
}

/**
 * Refuses a write aimed outside the caller's own region.
 *
 * `message` is rendered verbatim by the portal, so it is passed in by the
 * caller and phrased for the action being refused ("You can only broadcast to
 * your own region"), while `code` stays stable for branching.
 */
export function assertOwnRegion(
  own: Region,
  target: Region | null | undefined,
  message: string,
): void {
  if (target !== own) {
    throw new ForbiddenException({
      message,
      code: 'REGION_NOT_ALLOWED',
      statusCode: HttpStatus.FORBIDDEN,
    });
  }
}

/** Refuses a write aimed at a role the caller may not manage. */
export function forbidRole(message: string): never {
  throw new ForbiddenException({
    message,
    code: 'ROLE_NOT_ALLOWED',
    statusCode: HttpStatus.FORBIDDEN,
  });
}
