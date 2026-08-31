/**
 * Removes the Chinese characters the ERP embeds inside otherwise-Latin values.
 *
 * ITEM_SPECIFICATION mixes a size with a Chinese product category:
 * '500ML果汁(O)' is 500ML apple JUICE (O), '210ML果味(O)' is 210ML FLAVOURED.
 * The distributor-facing app shows the size, and the category is already
 * carried by ITEM_DESCRIPTION in English, so the CJK runs are dropped.
 *
 * Ranges covered: CJK Unified Ideographs and its Extension A, plus the
 * compatibility block and CJK punctuation - everything the feed has been seen
 * to use. Latin letters, digits, brackets and hyphens are untouched.
 *
 * Whitespace left behind by a removal is collapsed, so '500ML 果汁 (O)' comes
 * back as '500ML (O)' rather than with a double space. A value that was
 * ENTIRELY Chinese collapses to an empty string, which is returned as null -
 * an empty specification is not information.
 */
export function stripCjk(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const stripped = value
    .replace(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped === '' ? null : stripped;
}
