import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { buildRegionScope, RegionScope } from '../region/region-scope';

interface AuthenticatedUser {
  type?: 'CUSTOMER' | 'STAFF';
  role?: string;
  region?: string | null;
}

interface RequestWithUser {
  user?: AuthenticatedUser;
}

export const CurrentRegionScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RegionScope => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = req.user;

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
