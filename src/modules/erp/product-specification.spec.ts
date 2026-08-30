import { resolveProduct } from './product-specification.resolver';
import { PRODUCT_SPECIFICATIONS } from './product-specifications';

/**
 * Mapping an ERP sales-order line to the Viju product specification sheet.
 *
 * The brief was "map ITEM_DESCRIPTION to the product name in the sheet", but
 * the sheet's names are not unique — the same drink ships in several sizes with
 * different carton weights. ITEM_SPECIFICATION is what disambiguates.
 */
describe('Product specification mapping', () => {
  it('embeds the whole sheet', () => {
    // Read at runtime it would be absent from the container: .dockerignore
    // excludes *.md.
    expect(PRODUCT_SPECIFICATIONS).toHaveLength(95);
  });

  it('every spec maps to exactly one weight — the property the match relies on', () => {
    const weightsBySpec = new Map<string, Set<number>>();
    for (const r of PRODUCT_SPECIFICATIONS) {
      const set = weightsBySpec.get(r.spec) ?? new Set<number>();
      set.add(r.weightPerCarton);
      weightsBySpec.set(r.spec, set);
    }
    const conflicting = [...weightsBySpec.entries()].filter(
      ([, w]) => w.size > 1,
    );
    expect(conflicting).toEqual([]);
  });

  it('resolves an exact spec + name pair', () => {
    expect(resolveProduct('750ml water(L-水)', '750ML(L)')).toEqual({
      productId: '101020104',
      productName: '750ml water(L-水)',
      weightPerCarton: 9.38,
      matchedOn: 'SPEC_AND_NAME',
    });
  });

  it('returns the feed name verbatim, never the sheet spelling', () => {
    // The sheet says '750ml water(L-水)'; whatever the feed says is what the
    // caller asked to see.
    const r = resolveProduct('750ml Water(Lagos)', '750ML(L)');
    expect(r.productName).toBe('750ml Water(Lagos)');
  });

  it('falls back to the spec when only the name is unfamiliar', () => {
    // '750ml Water(Lagos)' is not in the sheet, but 750ML(L) is — and the
    // size is what determines carton weight.
    const r = resolveProduct('750ml Water(Lagos)', '750ML(L)');
    expect(r.weightPerCarton).toBe(9.38);
    expect(r.matchedOn).toBe('SPEC');
  });

  it('folds full-width brackets, case and spacing', () => {
    const wide = resolveProduct(
      'VIJU APPLE BBSTAR MILK（NEW）',
      '210ML果味（O）',
    );
    expect(wide.weightPerCarton).toBe(5.74);
    expect(wide.matchedOn).not.toBe('NONE');
  });

  describe('ambiguity is never guessed away', () => {
    it('refuses a name-only match when the sheet gives two weights', () => {
      // VIJU WHEAT MILK is 4.22 kg/carton at 320ML and 6.6 kg at 500ML. With
      // no spec to disambiguate, picking one would be wrong half the time.
      const r = resolveProduct('Viju Wheat Milk', 'NOT-A-REAL-SPEC');
      expect(r).toMatchObject({
        productId: null,
        weightPerCarton: null,
        matchedOn: 'NONE',
      });
    });

    it('resolves that same name once the spec says which size', () => {
      expect(resolveProduct('Viju Wheat Milk', '320ML中性奶(O)')).toMatchObject(
        {
          weightPerCarton: 4.22,
          matchedOn: 'SPEC_AND_NAME',
        },
      );
      expect(resolveProduct('Viju Wheat Milk', '500ML中性奶(O)')).toMatchObject(
        {
          weightPerCarton: 6.6,
          matchedOn: 'SPEC_AND_NAME',
        },
      );
    });

    it('gives the weight but not the code when a spec covers several products', () => {
      // 500ML碳酸 sizes share a weight but not an item code.
      const r = resolveProduct('SOME UNLISTED DRINK', '500ML中性奶(O)');
      expect(r.weightPerCarton).toBe(6.6);
      expect(r.productId).toBeNull();
      expect(r.matchedOn).toBe('SPEC');
    });

    it('returns nulls for a product the sheet does not cover', () => {
      // 18.9L water and the cracker lines are genuinely absent today.
      expect(
        resolveProduct('CREAM CRACKERS 饼干', '100G/PCS 24PCS/CTN'),
      ).toEqual({
        productId: null,
        productName: 'CREAM CRACKERS 饼干',
        weightPerCarton: null,
        matchedOn: 'NONE',
      });
    });

    it('labels a line the ERP left unnamed', () => {
      expect(resolveProduct(null, null).productName).toBe('Unspecified');
    });
  });
});
