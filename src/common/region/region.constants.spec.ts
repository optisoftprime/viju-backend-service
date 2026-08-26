import {
  BP_CLUSTER_CODE_BY_REGION,
  BP_CLUSTER_CODE_VALUES,
  REGION_BY_BP_CLUSTER_CODE,
  REGION_LABELS,
  REGION_VALUES,
  Region,
  UnknownBpClusterCodeError,
  bpClusterCodeForRegion,
  isBpClusterCode,
  isRegion,
  parseBpClusterCode,
  regionFromBpClusterCode,
  regionLabel,
  tryRegionFromBpClusterCode,
} from './region.constants';

/**
 * The BP_CLUSTER_CODE contract as the ERP states it. Hard-coded here on
 * purpose: if someone edits REGION_DEFINITIONS, this table is what has to
 * agree with them.
 */
const ERP_CONTRACT: ReadonlyArray<[number, Region, string]> = [
  [1, Region.LAGOS, 'LAGOS'],
  [2, Region.EASTERN, 'EASTERN'],
  [3, Region.SOUTH_SOUTH, 'SOUTH-SOUTH'],
  [4, Region.WESTERN, 'WESTERN'],
  [5, Region.NORTH, 'NORTH'],
];

describe('region constants', () => {
  describe('BP_CLUSTER_CODE mapping', () => {
    it.each(ERP_CONTRACT)(
      'maps BP_CLUSTER_CODE %i to %s',
      (code, region, label) => {
        expect(regionFromBpClusterCode(code)).toBe(region);
        expect(REGION_BY_BP_CLUSTER_CODE[code]).toBe(region);
        expect(regionLabel(region)).toBe(label);
        expect(REGION_LABELS[region]).toBe(label);
      },
    );

    it('covers every ERP region, and OTHERS on top', () => {
      // R-1 - OTHERS is a PORTAL region, not an ERP territory: it is the
      // catch-all for a customer whose BP_CLUSTER_CODE maps to none of the
      // five (the feed carries 9, GZ001 and GZ020 among others). So the enum
      // is deliberately one longer than the ERP contract, and OTHERS comes
      // last, after the code-ordered five.
      expect(REGION_VALUES).toEqual([
        ...ERP_CONTRACT.map(([, region]) => region),
        Region.OTHERS,
      ]);

      // ...but it contributes NO code. The ERP side of the contract is
      // unchanged, which is the point: nothing the ERP sends can produce
      // OTHERS.
      expect(BP_CLUSTER_CODE_VALUES).toEqual(
        ERP_CONTRACT.map(([code]) => code),
      );

      // Every value the Prisma enum knows about is still present in the map,
      // so a new region cannot be added without deciding its code...
      expect(Object.keys(BP_CLUSTER_CODE_BY_REGION).sort()).toEqual(
        Object.values(Region).sort(),
      );
      // ...and OTHERS' decision is "none".
      expect(BP_CLUSTER_CODE_BY_REGION[Region.OTHERS]).toBeNull();
      expect(bpClusterCodeForRegion(Region.OTHERS)).toBeNull();
    });

    it('round-trips every CODED region -> code -> region', () => {
      for (const [, region] of ERP_CONTRACT) {
        const code = bpClusterCodeForRegion(region);
        expect(code).not.toBeNull();
        expect(regionFromBpClusterCode(code)).toBe(region);
      }
    });

    it('is still a real region everywhere else', () => {
      // OTHERS has no code, but it is a first-class region for filters,
      // pickers and user records — which is the whole of R-1.
      expect(isRegion(Region.OTHERS)).toBe(true);
      expect(isRegion('OTHERS')).toBe(true);
      expect(regionLabel(Region.OTHERS)).toBe('OTHERS');
      // And nothing the ERP can send maps to it.
      expect(tryRegionFromBpClusterCode(6)).toBeNull();
      expect(tryRegionFromBpClusterCode('GZ020')).toBeNull();
    });
  });

  describe('parseBpClusterCode', () => {
    it('accepts numeric strings, because ERP payloads are inconsistent', () => {
      expect(parseBpClusterCode('3')).toBe(3);
      expect(parseBpClusterCode(' 3 ')).toBe(3);
      expect(tryRegionFromBpClusterCode('3')).toBe(Region.SOUTH_SOUTH);
    });

    it.each([0, 6, -1, 1.5, NaN, '', '  ', 'LAGOS', null, undefined, {}])(
      'rejects %p',
      (value) => {
        expect(parseBpClusterCode(value)).toBeNull();
        expect(isBpClusterCode(value)).toBe(false);
        expect(tryRegionFromBpClusterCode(value)).toBeNull();
      },
    );
  });

  describe('regionFromBpClusterCode', () => {
    it('throws on an unknown code so bad ERP data cannot be stored silently', () => {
      expect(() => regionFromBpClusterCode(9)).toThrow(
        UnknownBpClusterCodeError,
      );
      expect(() => regionFromBpClusterCode(9)).toThrow(
        'Unknown BP_CLUSTER_CODE 9. Expected one of: 1, 2, 3, 4, 5.',
      );
    });

    it('throws when the code is missing entirely', () => {
      expect(() => regionFromBpClusterCode(undefined)).toThrow(
        UnknownBpClusterCodeError,
      );
    });
  });

  describe('isRegion', () => {
    it('accepts current enum values', () => {
      expect(isRegion('SOUTH_SOUTH')).toBe(true);
      expect(isRegion(Region.WESTERN)).toBe(true);
    });

    it('rejects the retired pre-BP_CLUSTER_CODE values', () => {
      expect(isRegion('SOUTH_WEST')).toBe(false);
      expect(isRegion('SOUTH_EAST')).toBe(false);
      expect(isRegion(3)).toBe(false);
    });
  });
});
