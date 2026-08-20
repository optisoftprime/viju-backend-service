import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Requests allowed per window, per client IP. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Message returned once the limit is exceeded. */
  message?: string;
}

/**
 * Caps how often one IP may call a route. Apply with the guard:
 *
 *   @UseGuards(RateLimitGuard)
 *   @RateLimit({ limit: 5, windowMs: 60 * 60 * 1000 })
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

interface Bucket {
  count: number;
  /** Epoch ms at which this bucket resets. */
  expiresAt: number;
}

/**
 * Per-IP fixed-window rate limiter for public, unauthenticated routes.
 *
 * In-process and dependency-free, which matches how the app is deployed
 * today: one node, and the only route that needs limiting is the public
 * contact form. It is a spam brake, not a security control — if the API is
 * ever scaled horizontally, or more routes need limiting, this is the single
 * place to swap for a shared store.
 *
 * Expired buckets are swept opportunistically, so an attacker cycling
 * source IPs cannot grow the map without bound.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const key = `${context.getClass().name}.${context.getHandler().name}:${this.clientIp(req)}`;
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      this.buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
      return true;
    }

    if (bucket.count >= options.limit) {
      throw new HttpException(
        {
          message:
            options.message ?? 'Too many requests. Please try again later.',
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;
    return true;
  }

  /**
   * Client IP, preferring the left-most X-Forwarded-For entry so the limit
   * follows the real caller when the API sits behind a proxy.
   */
  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof first === 'string' && first.trim()) {
      return first.split(',')[0].trim();
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  /** Drops expired buckets, at most once a minute. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }
}
