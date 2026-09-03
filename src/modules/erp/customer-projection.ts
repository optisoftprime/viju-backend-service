import {
  BP_CLUSTER_CODE_VALUES,
  REGION_BY_BP_CLUSTER_CODE,
} from '../../common/region/region.constants';

/**
 * Projecting ERP customers into the portal's own `Customer` table.
 *
 * WHY THIS EXISTS: `erp_raw.raw_customer` holds 3,747 customers, 1,911 of them
 * in a Viju region. The projector that copies them into `Customer` lives in
 * another service and had copied NINE. Every region-scoped screen reads
 * `Customer`, so a region with no projected rows renders empty however
 * correct its mapping is - which is how OTHERS (BP_CLUSTER_CODE 9, 58
 * customers) came to be invisible everywhere while LAGOS looked merely thin.
 *
 * This is a reconciler, not a rewrite: it INSERTS the customers that are
 * missing and never touches a row that already exists. The nine curated
 * accounts keep their real phone numbers, their officers and their history.
 *
 * ─── Which rows ─────────────────────────────────────────────────────────
 *
 * Only BP_CLUSTER_CODEs the region mapping knows - 1-5 and 9. `GZ001`,
 * `GZ020` and `GH100` are other group entities' customer-coding schemes
 * rather than Viju territories; giving them a region would file another
 * company's customers under a Viju one. They stay out, and keep surfacing in
 * the dashboard's `unmappedRegionCount` where a human can question them.
 *
 * `DISTINCT ON (CUSTOMER_CODE)` collapses repeated feed rows for one customer
 * to the freshest, so a customer cannot be inserted twice.
 *
 * ─── The phone number ───────────────────────────────────────────────────
 *
 * THE ERP'S PHONE NUMBERS CANNOT BE USED, and this is a security matter
 * rather than a data-quality one. Across the 1,911 customers in a Viju
 * region the feed states 1,909 phone numbers - drawn from TWELVE distinct
 * values, one of them (0913580925) repeated 1,897 times. It is a placeholder
 * the ERP fills in, not a contact number.
 *
 * `Customer.phone` is unique AND is the login identifier: both the OTP flow
 * and the password flow resolve an account with
 * `findFirst({ where: { phone } })`. Copying the feed's value would mean
 * 1,897 distributors sharing one login, and whoever holds that number
 * reaching an arbitrary one of their accounts. So every projected row gets a
 * synthetic `ERP-<CUSTOMER_CODE>` instead: unique by construction, and
 * obviously not a number anyone can send an OTP to.
 *
 * `password` is left NULL, so the password path refuses these rows too. A
 * projected customer is a DIRECTORY ENTRY - it makes the distributor visible
 * to admins, regional admins and reports - and becomes a login only when
 * onboarding sets a real, verified number.
 */

/** Prefix marking a phone the portal invented because the ERP had none usable. */
export const PROJECTED_PHONE_PREFIX = 'ERP-';

/**
 * `BP_CLUSTER_CODE` -> `Region`, as SQL.
 *
 * Built from the same table the rest of the application reads, so adding a
 * region means editing `region.constants.ts` alone - this cannot drift from
 * it. Both sides are our own constants (integers and enum members), never
 * caller input, so interpolating them is safe.
 */
export function regionCaseSql(column: string): string {
  const whens = Object.entries(REGION_BY_BP_CLUSTER_CODE)
    .map(([code, region]) => `WHEN '${code}' THEN '${region}'`)
    .join('\n             ');
  return `CASE ${column}\n             ${whens}\n           END`;
}

/** The BP_CLUSTER_CODEs that map to a region, quoted for an IN list. */
export function mappedClusterCodesSql(): string {
  return BP_CLUSTER_CODE_VALUES.map((code) => `'${String(code)}'`).join(', ');
}

/**
 * Inserts every mapped ERP customer that has no `Customer` row yet.
 *
 * `ON CONFLICT DO NOTHING` covers the whole row rather than one constraint:
 * the `NOT EXISTS` already excludes known erpIds, so a conflict here means a
 * synthetic phone has somehow been taken, and skipping that one customer is
 * better than failing the pass for the other 1,900.
 */
export function buildCustomerProjectionSql(): string {
  return `
INSERT INTO "Customer" (id, "erpId", name, phone, region, "accountStatus", "updatedAt")
SELECT gen_random_uuid(),
       v.erp_id,
       v.name,
       '${PROJECTED_PHONE_PREFIX}' || v.erp_id,
       (${regionCaseSql('v.cluster_code')})::"Region",
       'ACTIVE'::"AccountStatus",
       now()
  FROM (
    SELECT DISTINCT ON (payload->>'CUSTOMER_CODE')
           payload->>'CUSTOMER_CODE'   AS erp_id,
           coalesce(
             nullif(trim(payload->>'CUSTOMER_NAME'), ''),
             nullif(trim(payload->>'CUSTOMER_FULL_NAME'), ''),
             'ERP ' || (payload->>'CUSTOMER_CODE')
           )                           AS name,
           payload->>'BP_CLUSTER_CODE' AS cluster_code
      FROM erp_raw.raw_customer
     WHERE payload->>'BP_CLUSTER_CODE' IN (${mappedClusterCodesSql()})
       AND coalesce(payload->>'CUSTOMER_CODE', '') <> ''
     ORDER BY payload->>'CUSTOMER_CODE', last_seen_at DESC NULLS LAST
  ) v
 WHERE NOT EXISTS (
   SELECT 1 FROM "Customer" c WHERE c."erpId" = v.erp_id
 )
ON CONFLICT DO NOTHING`;
}
