/**
 * The ERP's three customer-facing financial ledgers.
 *
 * Each is a separate `erp_raw` table with its own money columns but the same
 * document skeleton — DOC_NO, DOC_DATE, CUSTOMER_CODE, an approval stamp and a
 * remark. One config table drives one query builder rather than three
 * near-identical services, so a fix to the scoping or the paging applies to
 * all three at once.
 *
 * ─── Scoping ────────────────────────────────────────────────────────────
 *
 * Unlike `raw_sales_order`, which keys on the ERP's internal customer GUID and
 * needs `customer_link` to bridge, all three of these carry `CUSTOMER_CODE`
 * directly — the same value held as `Customer.erpId`. The predicate is
 * therefore a straight equality, and it is present on BOTH the list and the
 * detail query: a distributor cannot read another's document by guessing a
 * DOC_NO.
 *
 * ─── Money ──────────────────────────────────────────────────────────────
 *
 * The ERP states most amounts twice, `_FC` and `_TC`. Both are returned rather
 * than picking one: which is meaningful depends on whether the document was
 * raised in the company's own currency, and inferring that here would be a
 * guess. `EXCHANGE_RATE` is returned alongside so a caller can reconcile them.
 */

/** One money column pair, as the ERP names them. */
interface MoneyField {
  /** Field name in the API response. */
  name: string;
  /** Payload key, without the _FC / _TC suffix. */
  key: string;
  /** What it means, for the Swagger description. */
  description: string;
}

export interface FinancialRecordConfig {
  /** URL segment, e.g. 'collections'. */
  slug: string;
  /** `erp_raw` table name. */
  table: string;
  /** `object_type` discriminator inside that table. */
  objectType: string;
  /** Human name for docs and error messages. */
  label: string;
  /** The money columns this ledger carries, each as an _FC / _TC pair. */
  amounts: MoneyField[];
}

/**
 * One config per ledger, referenced DIRECTLY by its own route handler.
 *
 * There is no runtime slug lookup: each endpoint names its config at the call
 * site, so an unknown ledger is impossible by construction rather than a 404
 * to be remembered, and the table name can never be influenced by a path
 * segment.
 */
const RECORDS: readonly FinancialRecordConfig[] = [
  {
    slug: 'collection',
    table: 'raw_collection',
    objectType: 'COLLECTION',
    label: 'Collection',
    amounts: [
      {
        name: 'collectionAmount',
        key: 'COLLECTION_AMT',
        description: 'The amount collected.',
      },
      {
        name: 'cashDiscountAmount',
        key: 'CASH_DISCOUNT_AMT',
        description: 'Cash discount applied on settlement.',
      },
      {
        name: 'additionalExpenseAmount',
        key: 'ADDITIONAL_EXPENSE_AMT',
        description: 'Additional expense booked against the collection.',
      },
      {
        name: 'settlementExpenseAmount',
        key: 'SETTLE_EXPENSE_AMT',
        description: 'Settlement expense.',
      },
      {
        name: 'gainAmount',
        key: 'GAIN_AMT',
        description: 'Exchange or settlement gain.',
      },
    ],
  },
  {
    slug: 'refund',
    table: 'raw_ar_refund',
    objectType: 'AR_REFUND',
    label: 'AR refund',
    amounts: [
      {
        name: 'refundAmount',
        key: 'REFUND_AMT',
        description: 'The amount refunded.',
      },
      {
        name: 'receivablesAmount',
        key: 'RECEIVABLES_AMT',
        description: 'Receivables the refund was raised against.',
      },
      {
        name: 'arVerificationAmount',
        key: 'AR_VERIFICATION_AMT',
        description: 'Accounts-receivable amount verified.',
      },
      {
        name: 'advanceReceiptVerifiedAmount',
        key: 'ADV_REC_VERIFIED_AMT',
        description: 'Advance receipt verified against this refund.',
      },
      {
        name: 'cashDiscountAmount',
        key: 'CASH_DISCOUNT_AMT',
        description: 'Cash discount applied.',
      },
      {
        name: 'additionalExpenseAmount',
        key: 'ADDITIONAL_EXPENSE_AMT',
        description: 'Additional expense booked against the refund.',
      },
      { name: 'gainAmount', key: 'GAIN_AMT', description: 'Exchange gain.' },
      { name: 'lossAmount', key: 'LOSS_AMT', description: 'Exchange loss.' },
    ],
  },
  {
    slug: 'receivable',
    table: 'raw_other_receivable',
    objectType: 'OTHER_RECEIVABLE',
    label: 'Other receivable',
    amounts: [
      {
        name: 'amount',
        key: 'AMT',
        description: 'The document amount.',
      },
      {
        name: 'receivableAmount',
        key: 'RECEIVABLE_AMT',
        description: 'The receivable raised.',
      },
      {
        name: 'additionalExpenseAmount',
        key: 'ADDITIONAL_EXPENSE_AMT',
        description: 'Additional expense booked against it.',
      },
    ],
  },
];

/** Every ledger, for iteration in tests and docs. */
export const FINANCIAL_RECORDS = RECORDS;

/** `raw_collection` - money received. */
export const COLLECTION_RECORD = bySlug('collection');
/** `raw_ar_refund` - AR refunds. */
export const REFUND_RECORD = bySlug('refund');
/** `raw_other_receivable` - other receivables. */
export const RECEIVABLE_RECORD = bySlug('receivable');

function bySlug(slug: string): FinancialRecordConfig {
  const config = RECORDS.find((r) => r.slug === slug);
  // A missing config is a programming error in this file, not a runtime
  // condition - fail at import rather than serving a broken route.
  if (!config) throw new Error(`No financial record config for '${slug}'`);
  return config;
}

/**
 * The SELECT list shared by the list and detail queries.
 *
 * Table and column names are interpolated from the config above — a closed,
 * code-owned set, never anything a caller supplies. The only user-supplied
 * values (customer code, DOC_NO, paging) are bound parameters.
 */
function selectColumns(config: FinancialRecordConfig): string {
  const money = config.amounts
    .flatMap((a) => [
      `nullif(r.payload->>'${a.key}_FC', '')::numeric AS ${snake(a.name)}_fc`,
      `nullif(r.payload->>'${a.key}_TC', '')::numeric AS ${snake(a.name)}_tc`,
    ])
    .join(',\n           ');

  return `r.payload->>'DOC_NO'           AS doc_no,
           r.payload->>'DOC_DATE'         AS doc_date,
           r.payload->>'BOOKKEEPING_DATE' AS bookkeeping_date,
           r.payload->>'CUSTOMER_CODE'    AS customer_code,
           r.payload->>'CUSTOMER_NAME'    AS customer_name,
           r.payload->>'ApproveStatus'    AS approve_status,
           r.payload->>'ApproveDate'      AS approve_date,
           r.payload->>'REMARK'           AS remark,
           nullif(r.payload->>'EXCHANGE_RATE', '')::numeric AS exchange_rate,
           ${money},
           r.changed_at AS changed_at`;
}

/** camelCase -> snake_case, for the SQL aliases. */
function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * One page for a customer, newest first.
 *
 * `$1` customer code, `$2` limit, `$3` offset. Ordered on the booking date
 * with DOC_NO as a deterministic tie-break, so paging cannot repeat or skip a
 * row when two documents share a date.
 */
export function financialRecordsPageSql(config: FinancialRecordConfig): string {
  return `
    SELECT ${selectColumns(config)}
      FROM erp_raw.${config.table} r
     WHERE r.object_type = '${config.objectType}'
       AND r.payload->>'CUSTOMER_CODE' = $1
     ORDER BY coalesce(nullif(r.payload->>'DOC_DATE', ''),
                       nullif(r.payload->>'BOOKKEEPING_DATE', '')) DESC NULLS LAST,
              r.payload->>'DOC_NO' DESC
     LIMIT $2 OFFSET $3`;
}

/** How many documents this customer has in this ledger. `$1` customer code. */
export function financialRecordsCountSql(
  config: FinancialRecordConfig,
): string {
  return `
    SELECT count(*)::int AS n
      FROM erp_raw.${config.table} r
     WHERE r.object_type = '${config.objectType}'
       AND r.payload->>'CUSTOMER_CODE' = $1`;
}

/**
 * One document. `$1` customer code, `$2` DOC_NO.
 *
 * The customer predicate is deliberately retained: without it a distributor
 * could read another's document by guessing a number.
 */
export function financialRecordDetailSql(
  config: FinancialRecordConfig,
): string {
  return `
    SELECT ${selectColumns(config)}
      FROM erp_raw.${config.table} r
     WHERE r.object_type = '${config.objectType}'
       AND r.payload->>'CUSTOMER_CODE' = $1
       AND r.payload->>'DOC_NO' = $2
     ORDER BY r.changed_at DESC NULLS LAST
     LIMIT 1`;
}
