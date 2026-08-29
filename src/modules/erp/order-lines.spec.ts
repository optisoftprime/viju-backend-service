import { ErpOrderLinesService } from './erp-order-lines.service';
import { ERP_ORDER_LINES_SQL } from './order-lines';

/**
 * Order line items from the ERP sales-order feed.
 *
 * The projector has copied PurchaseItem rows for 30 of 10,350 orders, so
 * `lines` / `lineItems` rendered empty on almost every order detail screen.
 * The feed carries one row per line, keyed by DOC_NO = Purchase.erpId.
 */
describe('ERP order lines', () => {
  const build = (rows: unknown, available = true) => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('to_regclass')) {
          return Promise.resolve([{ present: available }]);
        }
        if (rows instanceof Error) return Promise.reject(rows);
        return Promise.resolve(rows);
      }),
    };
    return { prisma, service: new ErpOrderLinesService(prisma as never) };
  };

  it('returns product, code and quantity per line', async () => {
    const { service } = build([
      {
        doc_no: 'D1',
        product_name: '750ml water(L)',
        item_code: 'd2e463ff',
        quantity: '3500',
        row_id: 1,
      },
    ]);

    const lines = await service.getLines('D1');
    expect(lines).toEqual([
      {
        id: '1',
        productName: '750ml water(L)',
        itemCode: 'd2e463ff',
        quantity: 3500,
        unitPrice: null,
        lineTotal: null,
      },
    ]);
  });

  it('leaves per-line money NULL rather than inventing it', async () => {
    // The feed repeats the ORDER total on every line - on a 3-product order
    // yoghurt and water both read 258,000 - so apportioning it would fabricate
    // prices that look authoritative and disagree with the ERP.
    const { service } = build([
      {
        doc_no: 'D1',
        product_name: 'YOGHURT',
        item_code: 'y',
        quantity: '20',
        row_id: 1,
      },
      {
        doc_no: 'D1',
        product_name: 'WATER',
        item_code: 'w',
        quantity: '400',
        row_id: 2,
      },
    ]);

    const lines = await service.getLines('D1');
    expect(
      lines.every((l) => l.unitPrice === null && l.lineTotal === null),
    ).toBe(true);
  });

  it('groups lines by order across a batch', async () => {
    const { service } = build([
      {
        doc_no: 'D1',
        product_name: 'A',
        item_code: null,
        quantity: '1',
        row_id: 1,
      },
      {
        doc_no: 'D2',
        product_name: 'B',
        item_code: null,
        quantity: '2',
        row_id: 2,
      },
      {
        doc_no: 'D1',
        product_name: 'C',
        item_code: null,
        quantity: '3',
        row_id: 3,
      },
    ]);

    const map = await service.getLinesByOrder(['D1', 'D2']);
    expect(map.get('D1')!.map((l) => l.productName)).toEqual(['A', 'C']);
    expect(map.get('D2')!.map((l) => l.productName)).toEqual(['B']);
  });

  it('asks for the whole page in ONE query, de-duplicated', async () => {
    const { service, prisma } = build([]);

    await service.getLinesByOrder(['D1', 'D2', 'D1', '']);

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2); // probe + query
    expect(prisma.$queryRawUnsafe).toHaveBeenLastCalledWith(
      ERP_ORDER_LINES_SQL,
      ['D1', 'D2'],
    );
  });

  it('returns an empty map when the feed is absent', async () => {
    const { service } = build([], false);
    await expect(service.getLinesByOrder(['D1'])).resolves.toEqual(new Map());
  });

  it('returns an empty map on a query error rather than failing the screen', async () => {
    const { service } = build(new Error('boom'));
    await expect(service.getLinesByOrder(['D1'])).resolves.toEqual(new Map());
  });

  it('does not query for an empty id list', async () => {
    const { service, prisma } = build([]);
    await expect(service.getLinesByOrder([])).resolves.toEqual(new Map());
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('labels a line the ERP left unnamed', async () => {
    const { service } = build([
      {
        doc_no: 'D1',
        product_name: null,
        item_code: null,
        quantity: '5',
        row_id: 9,
      },
    ]);
    expect((await service.getLines('D1'))[0].productName).toBe('Unspecified');
  });

  it('joins on DOC_NO, which is Purchase.erpId - no id bridge needed', () => {
    expect(ERP_ORDER_LINES_SQL).toContain("so.payload->>'DOC_NO' = ANY($1)");
    expect(ERP_ORDER_LINES_SQL).toContain("so.object_type = 'SALES_ORDER'");
  });

  it('preserves the ERP line ordering', () => {
    expect(ERP_ORDER_LINES_SQL).toContain(
      "ORDER BY so.payload->>'DOC_NO', so.payload->>'DCMS_ROWNUM'",
    );
  });
});
