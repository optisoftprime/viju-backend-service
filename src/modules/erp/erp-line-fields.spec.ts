import { ERP_ORDER_LINES_SQL } from './order-lines';
import { ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL } from './stock-balance';
import {
  ERP_WAYBILLS_PAGE_SQL,
  ERP_WAYBILL_DETAIL_SQL,
  ERP_WAYBILL_ITEMS_SQL,
} from './erp-waybills';
import {
  FINANCIAL_RECORDS,
  COLLECTION_RECORD,
  RECEIVABLE_RECORD,
  REFUND_RECORD,
  financialRecordDetailSql,
  financialRecordsCountSql,
  financialRecordsPageSql,
} from './erp-financial-records';

/**
 * The ERP field mappings these endpoints are contractually tied to. Reading
 * the wrong payload key is silent — the query still runs and returns nulls —
 * so the key names are asserted rather than left to review.
 */
describe('ERP line-level field mappings', () => {
  describe('invoice lines', () => {
    it('reads the item code from ITEM_CODE, not the ITEM_ID guid', () => {
      // ITEM_ID is '218137e0-e453-…', a guid. ITEM_CODE is '101010317'.
      expect(ERP_ORDER_LINES_SQL).toContain("'ITEM_CODE'        AS item_code");
      expect(ERP_ORDER_LINES_SQL).not.toContain("'ITEM_ID'");
    });

    it('reads unit price from PRICE and amount from AMOUNT', () => {
      expect(ERP_ORDER_LINES_SQL).toContain("'PRICE'");
      expect(ERP_ORDER_LINES_SQL).toContain("'AMOUNT'");
    });

    it('leaves money NULL rather than coalescing it to zero', () => {
      // The feed carries per-line money on ~6% of rows; a silent line must
      // read as "not stated", not "cost nothing".
      expect(ERP_ORDER_LINES_SQL).toContain(
        "nullif(so.payload->>'PRICE',  '')",
      );
      expect(ERP_ORDER_LINES_SQL).toContain(
        "nullif(so.payload->>'AMOUNT', '')",
      );
    });
  });

  describe('stock balance', () => {
    it('carries the ERP item code', () => {
      expect(ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL).toContain("'ITEM_CODE'");
    });

    it('takes any non-null code for a product rather than dropping the group', () => {
      expect(ERP_STOCK_BALANCE_FOR_CUSTOMER_SQL).toMatch(
        /min\(nullif\(so\.payload->>'ITEM_CODE', ''\)\)/,
      );
    });
  });

  describe('waybills', () => {
    it('takes QTY_TOTAL once, never summed', () => {
      // QTY_TOTAL is a DOCUMENT-level figure repeated on every line —
      // constant within all 292,886 documents. sum() would multiply it by the
      // line count (202 would read 808 on a four-line document).
      expect(ERP_WAYBILLS_PAGE_SQL).toContain(
        "max(nullif(so.payload->>'QTY_TOTAL', '')::numeric)",
      );
      expect(ERP_WAYBILLS_PAGE_SQL).not.toContain(
        "sum(nullif(so.payload->>'QTY_TOTAL'",
      );
    });

    it('sums AMOUNT for the document total, because it IS per-line', () => {
      expect(ERP_WAYBILLS_PAGE_SQL).toContain(
        "sum(nullif(so.payload->>'AMOUNT', '')::numeric)",
      );
    });

    it('computes tax per line before summing, since rates can differ', () => {
      // Applying one rate to the document total would be wrong whenever two
      // lines carry different TAX_RATEs.
      expect(ERP_WAYBILLS_PAGE_SQL).toMatch(
        /sum\(\s*nullif\(so\.payload->>'AMOUNT', ''\)::numeric\s*\*\s*coalesce\(nullif\(so\.payload->>'TAX_RATE', ''\)::numeric, 0\)\s*\)/,
      );
    });

    it('scopes the detail and items queries by CUSTOMER, not just DOC_NO', () => {
      // Without this a distributor could read another's document by guessing.
      for (const sql of [ERP_WAYBILL_DETAIL_SQL, ERP_WAYBILL_ITEMS_SQL]) {
        expect(sql).toContain('erp_customer_code = $1');
      }
    });

    it('returns item lines with the fields the detail screen binds to', () => {
      for (const key of [
        'ITEM_CODE',
        'ITEM_DESCRIPTION',
        'ITEM_SPECIFICATION',
        'PRICE',
        'AMOUNT',
        'TAX_RATE',
      ]) {
        expect(ERP_WAYBILL_ITEMS_SQL).toContain(`'${key}'`);
      }
    });

    it('orders items by the ERP’s own line ordering', () => {
      expect(ERP_WAYBILL_ITEMS_SQL).toContain("'DCMS_ROWNUM'");
    });
  });

  describe('financial ledgers', () => {
    it('covers the three requested feeds', () => {
      expect(FINANCIAL_RECORDS.map((r) => r.table).sort()).toEqual([
        'raw_ar_refund',
        'raw_collection',
        'raw_other_receivable',
      ]);
    });

    it.each(FINANCIAL_RECORDS.map((r) => [r.slug, r] as const))(
      '%s scopes every query by CUSTOMER_CODE',
      (_slug, config) => {
        for (const sql of [
          financialRecordsPageSql(config),
          financialRecordsCountSql(config),
          financialRecordDetailSql(config),
        ]) {
          expect(sql).toContain("r.payload->>'CUSTOMER_CODE' = $1");
        }
      },
    );

    it.each(FINANCIAL_RECORDS.map((r) => [r.slug, r] as const))(
      '%s exposes both the _FC and _TC figure for every amount',
      (_slug, config) => {
        const sql = financialRecordsPageSql(config);
        for (const a of config.amounts) {
          expect(sql).toContain(`'${a.key}_FC'`);
          expect(sql).toContain(`'${a.key}_TC'`);
        }
      },
    );

    it.each(FINANCIAL_RECORDS.map((r) => [r.slug, r] as const))(
      '%s pages deterministically',
      (_slug, config) => {
        // DOC_NO breaks ties, so paging cannot repeat or skip a row when two
        // documents share a date.
        expect(financialRecordsPageSql(config)).toContain(
          "r.payload->>'DOC_NO' DESC",
        );
      },
    );

    it('binds each route constant to its own table', () => {
      // The six routes reference these constants directly, so the table can
      // never be chosen by a path segment - there is no slug lookup to get
      // wrong and no unknown ledger to 404 on.
      expect(COLLECTION_RECORD.table).toBe('raw_collection');
      expect(REFUND_RECORD.table).toBe('raw_ar_refund');
      expect(RECEIVABLE_RECORD.table).toBe('raw_other_receivable');
    });

    it('uses the URL segments the mobile app calls', () => {
      expect(REFUND_RECORD.slug).toBe('refund');
      expect(COLLECTION_RECORD.slug).toBe('collection');
      expect(RECEIVABLE_RECORD.slug).toBe('receivable');
    });
  });
});
