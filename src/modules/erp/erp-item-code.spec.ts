import { ErpStockBalanceService } from './erp-stock-balance.service';
import { ErpItemCodeService } from './erp-item-code.service';

/**
 * Every stock row should carry an item code where one can be known.
 *
 * The ERP states ITEM_CODE on 5.7% of line rows, so a product is usually coded
 * SOMEWHERE in the feed but not on the rows a given query touches. Three
 * sources are consulted in order of authority; nothing is invented.
 */
describe('Item code resolution on the stock balance', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    product: '750ml water(L-水)',
    ordered_qty: 100,
    delivered_qty: 40,
    item_code: null,
    item_specification: '750ML(L)',
    last_order_date: '2026-06-11',
    ...over,
  });

  const build = (feedWide: Record<string, string> = {}) => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    const itemCodes = {
      codeFor: jest.fn((name: string) => feedWide[name] ?? null),
    };
    return {
      prisma,
      itemCodes,
      service: new ErpStockBalanceService(prisma as never, itemCodes as never),
    };
  };

  const balanceOf = async (rows: unknown[], feedWide = {}) => {
    const { prisma, service } = build(feedWide);
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ present: true }]) // isAvailable probe
      .mockResolvedValueOnce(rows);
    return (await service.getStockBalance('10110017')) as any;
  };

  it('prefers the code the ERP stated on these very rows', async () => {
    // The most specific source there is - do not go looking further.
    const res = await balanceOf([row({ item_code: '101020104' })], {
      '750ml water(L-水)': '999999999',
    });

    expect(res.products[0].itemCode).toBe('101020104');
  });

  it('falls back to the code the ERP states elsewhere in the feed', async () => {
    // 750ml water carries its code on 218 of 221,464 rows; a distributor
    // whose own orders miss all 218 used to see null.
    const res = await balanceOf([row()], {
      '750ml water(L-水)': '101020104',
    });

    expect(res.products[0].itemCode).toBe('101020104');
  });

  it('falls back to the specification sheet when the feed never codes it', async () => {
    // 58 of the feed's 152 products carry no code on any row.
    const res = await balanceOf([row()]);

    expect(res.products[0].itemCode).toBe('101020104');
  });

  it('stays null when no source names the product', async () => {
    // Packaging film, water pumps, biscuit freight. Never a guess.
    const res = await balanceOf([
      row({ product: 'PE包装膜Nylon', item_specification: null }),
    ]);

    expect(res.products[0].itemCode).toBeNull();
  });

  it('does not consult the sheet with a specification that is not the product’s', async () => {
    // Rows are grouped by product NAME and 4 names span several sizes. The
    // query passes null in that case rather than one size picked arbitrarily.
    const res = await balanceOf([
      row({ product: 'VIJU MULIIFRUIT FURIT JUICE', item_specification: null }),
    ]);

    expect(res.products[0].itemCode).toBeNull();
  });
});

describe('The feed-wide item-code map', () => {
  const build = (rows: unknown[]) => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(rows) };
    return { prisma, service: new ErpItemCodeService(prisma as never) };
  };

  it('reads a code once the map is built', async () => {
    const { service } = build([{ name: 'A', code: '101' }]);

    await service.ready();

    expect(service.codeFor('A')).toBe('101');
    expect(service.codeFor('B')).toBeNull();
  });

  it('never blocks a caller on the build', () => {
    // The query takes 7-10s against the live feed; a request must not wait.
    const { service } = build([{ name: 'A', code: '101' }]);

    expect(service.codeFor('A')).toBeNull(); // not built yet, answered now
  });

  it('builds once however many callers arrive', async () => {
    const { prisma, service } = build([{ name: 'A', code: '101' }]);

    service.codeFor('A');
    service.codeFor('A');
    service.codeFor('A');
    await service.ready();

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous map when a build comes back empty', async () => {
    // An empty result means the feed is absent or the query was cut short -
    // blanking every code would be worse than a stale one.
    const { prisma, service } = build([{ name: 'A', code: '101' }]);
    await service.ready();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await (service as any).build();

    expect(service.codeFor('A')).toBe('101');
  });

  it('survives a failed build', async () => {
    const { prisma, service } = build([]);
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('boom'));

    await expect(service.ready()).resolves.toBeUndefined();
    expect(service.codeFor('A')).toBeNull();
  });
});
