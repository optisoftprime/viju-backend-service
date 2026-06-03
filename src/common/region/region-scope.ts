import { Region, StaffRole } from '@prisma/client';

export interface RegionScope {
  /** Region filter to apply to Prisma where-clauses, or null for cross-region access. */
  regionFilter: { region: Region } | null;
  /** True when the user can see any region (ADMIN). */
  crossRegion: boolean;
  /** The user's home region, if any. */
  region: Region | null;
}

interface RegionScopeUserInput {
  type: 'CUSTOMER' | 'STAFF';
  role?: StaffRole | 'CUSTOMER';
  region?: Region | null;
}

/**
 * PRD Section 8: 'Officers, regional admins, and loading officers only see data
 * within their assigned region. Admin is the only role with cross-region visibility.'
 */
export function buildRegionScope(user: RegionScopeUserInput): RegionScope {
  if (user.type === 'CUSTOMER' || user.role === 'ADMIN') {
    return {
      regionFilter: null,
      crossRegion: user.role === 'ADMIN',
      region: user.region ?? null,
    };
  }

  if (!user.region) {
    return { regionFilter: null, crossRegion: false, region: null };
  }

  return {
    regionFilter: { region: user.region },
    crossRegion: false,
    region: user.region,
  };
}
