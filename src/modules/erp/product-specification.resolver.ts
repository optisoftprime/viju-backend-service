import {
  PRODUCT_SPECIFICATIONS,
  ProductSpecification,
} from './product-specifications';

/**
 * Resolves an ERP sales-order line to its product specification.
 *
 * ─── Why matching is not a simple name lookup ───────────────────────────
 *
 * The brief was "map ITEM_DESCRIPTION to the product name in the spec sheet",
 * but the sheet's names are not unique: 11 of them carry more than one item
 * code and weight, because the same drink ships in several sizes.
 * `VIJU WHEAT MILK` is 4.22 kg/carton at 320ML and 6.6 kg at 500ML, so a
 * name-only lookup would silently pick one and be wrong about half the time.
 *
 * ITEM_SPECIFICATION disambiguates it. Every SPEC in the sheet maps to exactly
 * ONE weight (verified across all 95 rows: zero conflicts), so the size is
 * what actually determines weight per carton.
 *
 * ─── Match order ────────────────────────────────────────────────────────
 *
 *   1. spec + name   exact pair - the most precise, and unambiguous
 *   2. name          only when that name has a single code/weight
 *   3. spec          weight is safe on spec alone; itemCode only if unique
 *   4. none          nulls, never a guess
 *
 * Against the live feed this resolves 140 of 204 distinct (description, spec)
 * pairs. The remainder - 18.9L water, crackers, a handful of regional variants
 * - are genuinely absent from the sheet and come back with nulls rather than a
 * fabricated weight.
 */
export interface ResolvedProduct {
  /** ERP item code from the sheet; null when it could not be resolved. */
  productId: string | null;
  /** ITEM_DESCRIPTION, verbatim from the feed. */
  productName: string;
  /** Kilograms per carton; null when the sheet does not cover this product. */
  weightPerCarton: number | null;
  /** How the row was matched, so a caller can judge how much to trust it. */
  matchedOn: 'SPEC_AND_NAME' | 'NAME' | 'SPEC' | 'NONE';
}

/**
 * Full-width brackets appear on both sides of this join and mean the same
 * thing, so they are folded together along with case and repeated spaces.
 */
function normalise(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ');
}

/** spec + name -> the one row that pair identifies. */
const bySpecAndName = new Map<string, ProductSpecification>();
/** name -> every row carrying it. */
const byName = new Map<string, ProductSpecification[]>();
/** spec -> every row carrying it. */
const bySpec = new Map<string, ProductSpecification[]>();

for (const row of PRODUCT_SPECIFICATIONS) {
  bySpecAndName.set(
    `${normalise(row.spec)}||${normalise(row.productName)}`,
    row,
  );
  const name = normalise(row.productName);
  byName.set(name, [...(byName.get(name) ?? []), row]);
  const spec = normalise(row.spec);
  bySpec.set(spec, [...(bySpec.get(spec) ?? []), row]);
}

/** The single distinct value of `pick` across rows, or null if they disagree. */
function unique<T>(
  rows: ProductSpecification[],
  pick: (r: ProductSpecification) => T,
): T | null {
  const values = new Set(rows.map(pick));
  return values.size === 1 ? rows[0] && pick(rows[0]) : null;
}

/**
 * Resolves one line. `productName` is always the feed's own ITEM_DESCRIPTION -
 * the sheet is consulted for the code and the weight, never to rename the
 * product.
 */
export function resolveProduct(
  itemDescription: string | null,
  itemSpecification: string | null,
): ResolvedProduct {
  const productName = itemDescription ?? 'Unspecified';
  const name = normalise(itemDescription);
  const spec = normalise(itemSpecification);

  const exact = bySpecAndName.get(`${spec}||${name}`);
  if (exact) {
    return {
      productId: exact.itemCode,
      productName,
      weightPerCarton: exact.weightPerCarton,
      matchedOn: 'SPEC_AND_NAME',
    };
  }

  const named = byName.get(name);
  if (named?.length) {
    const itemCode = unique(named, (r) => r.itemCode);
    const weight = unique(named, (r) => r.weightPerCarton);
    // Only trust a name-only match when the sheet is unambiguous about it.
    if (itemCode !== null && weight !== null) {
      return {
        productId: itemCode,
        productName,
        weightPerCarton: weight,
        matchedOn: 'NAME',
      };
    }
  }

  const specced = bySpec.get(spec);
  if (specced?.length) {
    // Weight is safe here: no SPEC in the sheet carries two different weights.
    // The item code often is not, so it is only returned when it agrees.
    return {
      productId: unique(specced, (r) => r.itemCode),
      productName,
      weightPerCarton: unique(specced, (r) => r.weightPerCarton),
      matchedOn: 'SPEC',
    };
  }

  return {
    productId: null,
    productName,
    weightPerCarton: null,
    matchedOn: 'NONE',
  };
}
