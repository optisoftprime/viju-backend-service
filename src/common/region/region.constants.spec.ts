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
  // R-1 - the ERP's own "other customers" bucket (其他客户). Note the gap:
  // 6, 7 and 8 are not codes the feed uses.
  [9, Region.OTHERS, 'OTHERS'],
];

/**
 * Codes the feed carries that are NOT territories.
 *
 * GZ001 (泷迪客户编码) and GZ020 (广州拓燊客户编码) are customer-coding schemes
 * for other group entities — GZ020 alone covers 1,832 customers, more than all
 * five Nigerian regions combined. Mapping them to a region would file another
 * company's customers under a Viju territory, so they stay unmapped and
 * surface in the dashboard's `unmappedRegionCount` instead.
 */
const NON_TERRITORY_CODES = ['GZ001', 'GZ020'];

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

    it('covers every region and nothing more', () => {
      expect(REGION_VALUES).toEqual(ERP_CONTRACT.map(([, region]) => region));
      expect(BP_CLUSTER_CODE_VALUES).toEqual(
        ERP_CONTRACT.map(([code]) => code),
      );
      // Every value the Prisma enum knows about must have a code.
      expect(Object.keys(BP_CLUSTER_CODE_BY_REGION).sort()).toEqual(
        Object.values(Region).sort(),
      );
    });

    it('round-trips region -> code -> region', () => {
      for (const region of REGION_VALUES) {
        expect(regionFromBpClusterCode(bpClusterCodeForRegion(region))).toBe(
          region,
        );
      }
    });

    it('maps the ERP’s own "other customers" bucket to OTHERS', () => {
      // R-1 - code 9 is named 其他客户 in the feed, so this is the ERP's
      // classification being honoured rather than a portal invention.
      expect(bpClusterCodeForRegion(Region.OTHERS)).toBe(9);
      expect(regionFromBpClusterCode(9)).toBe(Region.OTHERS);
      expect(regionFromBpClusterCode('9')).toBe(Region.OTHERS);
      expect(regionLabel(Region.OTHERS)).toBe('OTHERS');
      expect(isRegion('OTHERS')).toBe(true);
    });

    it('leaves the non-territory coding schemes unmapped', () => {
      // Mapping these would file another company's customers under a Viju
      // region. They must stay unmapped so they surface as unmapped.
      for (const code of NON_TERRITORY_CODES) {
        expect(tryRegionFromBpClusterCode(code)).toBeNull();
        expect(isBpClusterCode(code)).toBe(false);
      }
      // And the gap below 9 is still a gap.
      expect(tryRegionFromBpClusterCode(6)).toBeNull();
      expect(tryRegionFromBpClusterCode(8)).toBeNull();
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
      // R-1 - this used to assert on 9, which is now OTHERS. 8 is the nearest
      // code the feed genuinely does not use.
      expect(() => regionFromBpClusterCode(8)).toThrow(
        UnknownBpClusterCodeError,
      );
      expect(() => regionFromBpClusterCode(8)).toThrow(
        'Unknown BP_CLUSTER_CODE 8. Expected one of: 1, 2, 3, 4, 5, 9.',
      );
    });

    it('throws on the non-territory coding schemes', () => {
      // GZ020 is 1,832 customers of another group entity. Refusing it is the
      // point: they must not be silently filed under a Viju region.
      expect(() => regionFromBpClusterCode('GZ020')).toThrow(
        UnknownBpClusterCodeError,
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
