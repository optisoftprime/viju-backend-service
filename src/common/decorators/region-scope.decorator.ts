import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { buildRegionScope, RegionScope } from '../region/region-scope';

export const CurrentRegionScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RegionScope => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const user = req.user as {
      type?: 'CUSTOMER' | 'STAFF';
      role?: string;
      region?: string | null;
    } | undefined;

    if (!user) {
      return { regionFilter: null, crossRegion: false, region: null };
    }

    return buildRegionScope({
      type: user.type ?? 'STAFF',
      role: user.role as never,
      region: (user.region ?? null) as never,
    });
  },
);
