import { stripCjk } from './strip-cjk';

/**
 * ITEM_SPECIFICATION mixes a Latin size with a Chinese product category. The
 * app shows the size; the category is already carried in English by
 * ITEM_DESCRIPTION.
 */
describe('stripCjk', () => {
  it.each([
    ['500ML果汁(O)', '500ML(O)'],
    ['210ML果味(O)', '210ML(O)'],
    ['100ML中性', '100ML'],
    ['750ML(A)', '750ML(A)'],
  ])('%s -> %s', (input, expected) => {
    expect(stripCjk(input)).toBe(expected);
  });

  it('leaves a purely Latin value untouched', () => {
    expect(stripCjk('1.5L PET (L)')).toBe('1.5L PET (L)');
  });

  it('collapses the whitespace a removal leaves behind', () => {
    expect(stripCjk('500ML 果汁 (O)')).toBe('500ML (O)');
  });

  it('returns null for a value that was entirely Chinese', () => {
    // An empty specification is not information; null says "nothing to show".
    expect(stripCjk('唯久信用管控')).toBeNull();
  });

  it('passes null and undefined through', () => {
    expect(stripCjk(null)).toBeNull();
    expect(stripCjk(undefined)).toBeNull();
  });

  it('keeps digits, dots and hyphens', () => {
    expect(stripCjk('18.9L水-桶装')).toBe('18.9L-');
  });
});
