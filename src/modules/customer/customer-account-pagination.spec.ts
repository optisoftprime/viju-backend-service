import { CustomerService } from './customer.service';

/**
 * GET /customers/me/account — both lists paginated.
 *
 * `invoices` and `paymentHistory` were unbounded. One distributor already has
 * 4,660 invoices and 6,796 payments, so a single response carried 11,456 rows.
 */
describe('Account tab pagination', () => {
  const invoice = (n: number) => ({
    id: 'p' + n,
    erpId: 'VJ-2026-' + n,
    orderDate: new Date('2026-06-01T10:00:00Z'),
    totalValue: 45000,
    status: 'CLOSED',
  });
  const payment = (n: number) => ({
    id: 'pay' + n,
    date: new Date('2026-06-01T10:00:00Z'),
    amount: 25000,
    reference: 'TRX-' + n,
    runningBalance: 50000.5,
  });

  const build = (invoiceTotal = 4660, paymentTotal = 6796) => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          erpId: '10110017',
          outstandingBalance: 100,
          updatedAt: new Date('2026-06-09T08:16:56.533Z'),
          assignedOfficer: { id: 'o-1' },
        }),
      },
      purchase: {
        findMany: jest.fn().mockResolvedValue([invoice(1), invoice(2)]),
        count: jest.fn().mockResolvedValue(invoiceTotal),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([payment(1)]),
        count: jest.fn().mockResolvedValue(paymentTotal),
      },
    };
    const service = new CustomerService(
      prisma as never,
      {} as never,
      { getRunningBalance: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  };

  it('returns a meta for each list', async () => {
    const { service } = build();

    const res = await service.getInvoices('c-1', { page: 1, pageSize: 20 });

    expect(res.meta).toEqual({
      total: 4660,
      page: 1,
      pageSize: 20,
      totalPages: 233,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(res.paymentHistoryMeta).toMatchObject({
      total: 6796,
      totalPages: 340,
    });
  });

  it('counts each list separately — one meta cannot describe both', async () => {
    // 4,660 invoices against 6,796 payments: a shared total would truncate
    // the longer list without saying so.
    const { service } = build(4660, 6796);
    const res = await service.getInvoices('c-1', { page: 1, pageSize: 20 });
    expect(res.meta.total).not.toBe(res.paymentHistoryMeta.total);
  });

  it('applies page and pageSize to BOTH queries', async () => {
    const { service, prisma } = build();

    await service.getInvoices('c-1', { page: 3, pageSize: 25 });

    expect(prisma.purchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
  });

  it('clamps pageSize to 200 and echoes what was applied', async () => {
    const { service, prisma } = build();

    const res = await service.getInvoices('c-1', { page: 1, pageSize: 5000 });

    expect(res.meta.pageSize).toBe(200);
    expect(res.paymentHistoryMeta.pageSize).toBe(200);
    expect(prisma.purchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it('defaults to page 1, pageSize 20 when nothing is passed', async () => {
    const { service } = build();
    const res = await service.getInvoices('c-1');
    expect(res.meta).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('keeps the wallet balance and contact note beside the pages', async () => {
    const { service } = build();
    const res = await service.getInvoices('c-1', { page: 1, pageSize: 20 });
    expect(res.walletBalance).toMatchObject({ amount: 100, isOverdue: false });
    expect(res.contactNote).toContain('contact your Viju Account Officer');
  });

  it('still returns the rows themselves', async () => {
    const { service } = build();
    const res = await service.getInvoices('c-1', { page: 1, pageSize: 20 });
    expect(res.invoices).toHaveLength(2);
    expect(res.invoices[0]).toMatchObject({ orderId: 'VJ-2026-1' });
    expect(res.paymentHistory).toHaveLength(1);
  });

  it('reports a valid meta for a customer with nothing on the account', async () => {
    const { service, prisma } = build(0, 0);
    prisma.purchase.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);

    const res = await service.getInvoices('c-1', { page: 1, pageSize: 20 });

    expect(res.invoices).toEqual([]);
    expect(res.meta).toMatchObject({
      total: 0,
      totalPages: 1,
      hasNextPage: false,
    });
  });
});
