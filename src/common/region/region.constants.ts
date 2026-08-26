import { Region } from '@prisma/client';

/**
 * Single source of truth for regions across the whole application.
 *
 * The ERP identifies a customer's region with a numeric `BP_CLUSTER_CODE`
 * (business-partner cluster). That number is an integration detail: it enters
 * the system at the ERP boundary, is translated here, and must never travel
 * any further. Everything downstream — services, controllers, DTOs, filters,
 * reports, the database — speaks in the `Region` enum instead.
 *
 *   BP_CLUSTER_CODE 1 -> LAGOS
 *   BP_CLUSTER_CODE 2 -> EASTERN
 *   BP_CLUSTER_CODE 3 -> SOUTH_SOUTH   (displayed "SOUTH-SOUTH")
 *   BP_CLUSTER_CODE 4 -> WESTERN
 *   BP_CLUSTER_CODE 5 -> NORTH
 *
 * `Region` itself is the Prisma enum, re-exported here so callers have one
 * import to reach for. Adding a region means editing REGION_DEFINITIONS below
 * and the Prisma enum — nothing else.
 */
export { Region };

interface RegionDefinition {
  /** The canonical enum value, stored in the database and returned by the API. */
  readonly region: Region;
  /**
   * The ERP's numeric BP_CLUSTER_CODE for this region.
   *
   * `null` for OTHERS (R-1), which is a portal-side catch-all rather than an
   * ERP territory: the feed has no code that means "other", so nothing the ERP
   * sends can ever translate into it. Only an admin sets it.
   */
  readonly bpClusterCode: number | null;
  /** Human-facing label. Carries the hyphen the enum value cannot. */
  readonly label: string;
}

/**
 * The one table that defines regions. Both lookup directions, the ordered
 * value list and the display labels are all derived from it, so the mappings
 * cannot drift apart.
 *
 * Ordered by BP_CLUSTER_CODE, which is also the order the Prisma enum and the
 * Postgres type declare their values in.
 */
const REGION_DEFINITIONS = [
  { region: Region.LAGOS, bpClusterCode: 1, label: 'LAGOS' },
  { region: Region.EASTERN, bpClusterCode: 2, label: 'EASTERN' },
  { region: Region.SOUTH_SOUTH, bpClusterCode: 3, label: 'SOUTH-SOUTH' },
  { region: Region.WESTERN, bpClusterCode: 4, label: 'WESTERN' },
  { region: Region.NORTH, bpClusterCode: 5, label: 'NORTH' },
  // R-1 - last, and codeless. See RegionDefinition.bpClusterCode.
  { region: Region.OTHERS, bpClusterCode: null, label: 'OTHERS' },
] as const satisfies readonly RegionDefinition[];

/**
 * The codes the ERP actually sends. OTHERS contributes nothing here — it has
 * no code — so `null` is excluded and this stays the 1|2|3|4|5 union it was.
 */
export type BpClusterCode = Exclude<
  (typeof REGION_DEFINITIONS)[number]['bpClusterCode'],
  null
>;

/**
 * Every region, in BP_CLUSTER_CODE order. Use this for Swagger `enum:`
 * options, dashboard row ordering, report columns and filter dropdowns
 * instead of re-declaring the list locally.
 */
export const REGION_VALUES: readonly Region[] = REGION_DEFINITIONS.map(
  (d) => d.region,
);

/** BP_CLUSTER_CODE -> Region. The only place the numbers are interpreted. */
export const REGION_BY_BP_CLUSTER_CODE: Readonly<Record<number, Region>> =
  Object.freeze(
    Object.fromEntries(
      REGION_DEFINITIONS.filter(
        (d): d is typeof d & { bpClusterCode: number } =>
          d.bpClusterCode !== null,
      ).map((d) => [d.bpClusterCode, d.region]),
    ),
  );

/**
 * Region -> BP_CLUSTER_CODE, for calls that have to hand a code back to the ERP.
 *
 * `null` for OTHERS: there is no code to hand back. Callers must handle that
 * rather than assume every region round-trips to the ERP.
 */
export const BP_CLUSTER_CODE_BY_REGION: Readonly<
  Record<Region, BpClusterCode | null>
> = Object.freeze(
  Object.fromEntries(
    REGION_DEFINITIONS.map((d) => [d.region, d.bpClusterCode]),
  ) as Record<Region, BpClusterCode | null>,
);

/** Display labels. `SOUTH_SOUTH` renders as `SOUTH-SOUTH`; the rest are identical. */
export const REGION_LABELS: Readonly<Record<Region, string>> = Object.freeze(
  Object.fromEntries(
    REGION_DEFINITIONS.map((d) => [d.region, d.label]),
  ) as Record<Region, string>,
);

/** All valid BP_CLUSTER_CODE values, for error messages and validation. */
export const BP_CLUSTER_CODE_VALUES: readonly BpClusterCode[] =
  REGION_DEFINITIONS.map((d) => d.bpClusterCode).filter(
    (c): c is BpClusterCode => c !== null,
  );

/** Raised when the ERP sends a BP_CLUSTER_CODE this mapping does not know. */
export class UnknownBpClusterCodeError extends Error {
  constructor(readonly received: unknown) {
    super(
      `Unknown BP_CLUSTER_CODE ${JSON.stringify(received)}. ` +
        `Expected one of: ${BP_CLUSTER_CODE_VALUES.join(', ')}.`,
    );
    this.name = 'UnknownBpClusterCodeError';
  }
}

/** Type guard for values coming from JSON, query strings or the database. */
export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && REGION_VALUES.includes(value as Region);
}

/**
 * Normalise a raw BP_CLUSTER_CODE. ERP payloads are inconsistent about
 * whether the code arrives as a number or a numeric string, so both are
 * accepted. Returns null for anything that is not a known code.
 */
export function parseBpClusterCode(value: unknown): BpClusterCode | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isInteger(numeric)) return null;
  return BP_CLUSTER_CODE_VALUES.includes(numeric as BpClusterCode)
    ? (numeric as BpClusterCode)
    : null;
}

/** True when `value` is a BP_CLUSTER_CODE this mapping recognises. */
export function isBpClusterCode(value: unknown): value is BpClusterCode {
  return parseBpClusterCode(value) !== null;
}

/**
 * BP_CLUSTER_CODE -> Region, lenient. Returns null instead of throwing, for
 * callers that would rather leave the region unset than fail the whole
 * operation (e.g. staff records, whose region column is nullable).
 */
export function tryRegionFromBpClusterCode(value: unknown): Region | null {
  const code = parseBpClusterCode(value);
  return code === null ? null : REGION_BY_BP_CLUSTER_CODE[code];
}

/**
 * BP_CLUSTER_CODE -> Region, strict. Use at boundaries where a missing region
 * is not recoverable — a customer record cannot be stored without one.
 *
 * @throws {UnknownBpClusterCodeError} when the code is absent or unrecognised.
 */
export function regionFromBpClusterCode(value: unknown): Region {
  const region = tryRegionFromBpClusterCode(value);
  if (region === null) throw new UnknownBpClusterCodeError(value);
  return region;
}

/** Region -> BP_CLUSTER_CODE, for outbound ERP calls. */
/**
 * Region -> the ERP code, or `null` when the region has none.
 *
 * OTHERS (R-1) is the only codeless region. A caller filtering ERP rows by
 * region must treat `null` as "the ERP can hold no rows for this region"
 * rather than as "no filter" — the two are opposites.
 */
export function bpClusterCodeForRegion(region: Region): BpClusterCode | null {
  return BP_CLUSTER_CODE_BY_REGION[region];
}

/** Display label for a region, e.g. for CSV exports and PDF reports. */
export function regionLabel(region: Region): string {
  return REGION_LABELS[region];
}
