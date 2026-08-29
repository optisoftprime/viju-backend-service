import { ErpWaybillsService } from './erp-waybills.service';
import { ERP_WAYBILLS_PAGE_SQL, ERP_WAYBILLS_COUNT_SQL } from './erp-waybills';

/**
 * GET /customers/me/erp/waybills — the ERP's own goods-movement documents.
 *
 * A different resource from GET /customers/me/waybills, which lists the
 * loading requests raised through this app.
 */
describe('ERP waybills', () => {
  const row = (over = {}) => ({
    doc_no: '2300-202503070060',
    doc_date: '2025-03-07 00:00:00',
    order_date: '2025-03-07 00:00:00',
    ship_to: 'Lagos Depot',
    lines: 2,
    products: 1,
    ordered_qty: '3640',
    delivered_qty: '3500',
    status: 'PROCESSING',
    changed_at: new Date('2026-08-28T12:49:31.019Z'),
    ...over,
  });

  const build = (rows: unknown, count = 1, available = true) => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('to_regclass')) {
          return Promise.resolve([{ present: available }]);
        }
        if (rows instanceof Error) return Promise.reject(rows);
        if (sql === ERP_WAYBILLS_COUNT_SQL)
          return Promise.resolve([{ n: count }]);
        return Promise.resolve(rows);
      }),
    };
    return { prisma, service: new ErpWaybillsService(prisma as never) };
  };

  it('rolls line rows up to one row per document', async () => {
    const { service } = build([row()]);

    const page = await service.list('10110017', { page: 1, pageSize: 20 });

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({
      docNo: '2300-202503070060',
      lines: 2,
      products: 1,
      quantityOrdered: 3640,
      quantityDelivered: 3500,
      quantityRemaining: 140,
      status: 'PROCESSING',
    });
  });

  it('returns a standard meta block', async () => {
    const { service } = build([row()], 150);

    const page = await service.list('10110017', { page: 1, pageSize: 20 });

    expect(page.meta).toEqual({
      total: 150,
      page: 1,
      pageSize: 20,
      totalPages: 8,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('clamps pageSize and pages with a correct offset', async () => {
    const { service, prisma } = build([row()], 150);

    const page = await service.list('10110017', { page: 3, pageSize: 5000 });

    expect(page.meta.pageSize).toBe(200);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      ERP_WAYBILLS_PAGE_SQL,
      '10110017',
      200,
      400,
    );
  });

  it('floors an over-delivered document at zero', async () => {
    const { service } = build([
      row({ ordered_qty: '10', delivered_qty: '12' }),
    ]);
    const page = await service.list('10110017', { page: 1, pageSize: 20 });
    expect(page.data[0].quantityRemaining).toBe(0);
  });

  describe('degrades to an empty page rather than erroring', () => {
    const expectEmpty = (page: {
      data: unknown[];
      meta: { total: number };
    }) => {
      expect(page.data).toEqual([]);
      expect(page.meta).toMatchObject({ total: 0, page: 1, totalPages: 1 });
    };

    it('when the ERP feed is absent', async () => {
      const { service } = build([], 0, false);
      expectEmpty(await service.list('10110017', { page: 1, pageSize: 20 }));
    });

    it('when the customer has no erpId', async () => {
      const { service, prisma } = build([]);
      expectEmpty(await service.list('', { page: 1, pageSize: 20 }));
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('when the query fails', async () => {
      const { service } = build(new Error('boom'));
      expectEmpty(await service.list('10110017', { page: 1, pageSize: 20 }));
    });
  });

  describe('the SQL', () => {
    it('bridges erpId to the ERP customer uuid via the indexed link table', () => {
      // raw_sales_order.CUSTOMER_ID is the ERP's internal uuid, not erpId.
      // customer_link is the ingest service's bridge, indexed on both columns.
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('erp_raw.customer_link');
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('cl.erp_customer_code = $1');
      expect(ERP_WAYBILLS_PAGE_SQL).toContain("so.payload->>'CUSTOMER_ID' =");
    });

    it('groups by document, not by line', () => {
      expect(ERP_WAYBILLS_PAGE_SQL).toContain(
        "so.payload->>'DOC_NO' AS doc_no",
      );
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('GROUP BY 1');
    });

    it('reuses the order reconciler status precedence', () => {
      // Approved -> closed -> fully delivered -> otherwise processing.
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('WHEN NOT a.approved');
      expect(ERP_WAYBILLS_PAGE_SQL).toContain("THEN 'CLOSED'");
      expect(ERP_WAYBILLS_PAGE_SQL).toContain("THEN 'DELIVERED'");
    });

    it('orders newest first and pages in SQL', () => {
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('DESC NULLS LAST');
      expect(ERP_WAYBILLS_PAGE_SQL).toContain('LIMIT $2 OFFSET $3');
    });

    it('counts over the same rollup the page uses', () => {
      expect(ERP_WAYBILLS_COUNT_SQL).toContain(
        "so.payload->>'DOC_NO' AS doc_no",
      );
      expect(ERP_WAYBILLS_COUNT_SQL).toContain('count(*)::int AS n');
    });
  });
});
