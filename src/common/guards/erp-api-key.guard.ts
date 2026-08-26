import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { isDevMode } from '../utils/env';

/**
 * Guards the ERP webhook endpoints. ERP→app sync calls are server-to-server
 * and carry no JWT, so they authenticate with a shared secret sent in the
 * `x-api-key` header, compared against `process.env.ERP_API_KEY`.
 *
 * Fail-closed in production: if `ERP_API_KEY` is unset there, every request is
 * rejected. In development the guard is permissive (with a one-time warning) so
 * the webhooks stay easy to exercise locally.
 */
@Injectable()
export class ErpApiKeyGuard implements CanActivate {
  private static warned = false;
  private readonly logger = new Logger(ErpApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.ERP_API_KEY;

    if (!configured) {
      if (isDevMode()) {
        if (!ErpApiKeyGuard.warned) {
          this.logger.warn(
            'ERP_API_KEY is not set — ERP webhooks are UNAUTHENTICATED in dev. Set ERP_API_KEY before production.',
          );
          ErpApiKeyGuard.warned = true;
        }
        return true;
      }
      throw new UnauthorizedException(
        'ERP webhook authentication not configured',
      );
    }

    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-api-key'];

    if (typeof provided !== 'string' || !this.safeEqual(provided, configured)) {
      throw new UnauthorizedException('Invalid or missing ERP API key');
    }
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // timingSafeEqual throws on length mismatch, so guard the length first.
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
