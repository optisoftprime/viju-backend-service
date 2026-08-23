import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { BroadcastService } from './broadcast.service';

/**
 * P-3, P-4, P-5 — the distributor push matrix from spec 38.
 *
 * These pin the exact `content` each broadcast produces, because the frontend
 * renders it verbatim and splits a prefixed row on the first ": ". A change in
 * wording here is a visible change on a distributor's device.
 */
describe('Broadcast push matrix (P-3, P-4, P-5)', () => {
  let service: BroadcastService;

  const CUSTOMER = {
    id: 'cust-1',
    name: 'ADLAK',
    outstandingBalance: 5000,
    region: 'LAGOS',
  };

  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };

  const prisma = {
    customer: {
      findMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(CUSTOMER),
      update: jest.fn(),
    },
    payment: { create: jest.fn() },
    broadcast: { create: jest.fn().mockResolvedValue({ id: 'br-1' }) },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = module.get(BroadcastService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('P-3 — regional broadcast', () => {
    it('delivers the admin’s text verbatim, with no prefix or decoration', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: 'c-1' },
        { id: 'c-2' },
      ]);
      const message = 'Stock arrives Monday. Place orders before Friday 5pm.';

      await service.sendRegional('admin-1', {
        regions: ['LAGOS'],
        message,
      } as never);

      expect(notifications.notify).toHaveBeenCalledTimes(2);
      const payload = notifications.notify.mock.calls[0][0];
      // The whole point of P-3: no "Viju: " in front of the admin's words.
      expect(payload.content).toBe(message);
      expect(payload.type).toBe('BROADCAST');
      expect(payload.recipientType).toBe('CUSTOMER');
    });

    it('reaches every distributor in each selected region', async () => {
      prisma.customer.findMany.mockResolvedValue([
        { id: 'c-1' },
        { id: 'c-2' },
        { id: 'c-3' },
      ]);

      await service.sendRegional('admin-1', {
        regions: ['LAGOS', 'WESTERN'],
        message: 'Depot closed Saturday.',
      } as never);

      expect(notifications.notify).toHaveBeenCalledTimes(3);
      expect(
        notifications.notify.mock.calls.map((c) => c[0].recipientId),
      ).toEqual(['c-1', 'c-2', 'c-3']);
    });
  });

  describe('P-4 — individual broadcast, no allowance', () => {
    it('prefixes the message with the distributor’s own name', async () => {
      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Your March invoice is ready for review.',
      });

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.content).toBe(
        'ADLAK: Your March invoice is ready for review.',
      );
      expect(payload.data.allowanceAmount).toBeUndefined();
      // No wallet movement when no allowance was asked for.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('P-5 — individual broadcast with a delivery allowance', () => {
    const creditAllowance = (amount: number, at: Date) => {
      prisma.$transaction.mockResolvedValue([
        { id: 'cust-1' },
        { id: 'pay-1', amount, date: at },
      ]);
    };

    it('names the credited amount as currency and never rounds it', async () => {
      creditAllowance(1500.5, new Date('2026-08-23T09:39:58.000Z'));

      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Thanks for the bulk order',
        deliveryAllowance: 1500.5,
      });

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.content).toBe(
        'ADLAK: Thanks for the bulk order. Delivery allowance of ₦1,500.50 ' +
          'has been credited to your wallet.',
      );
    });

    it('reads the amount back from the payment, not from the request', async () => {
      // The wallet credit landed at a different figure than was asked for.
      // The distributor must be told what they actually got.
      creditAllowance(1499.99, new Date('2026-08-23T09:39:58.000Z'));

      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Bulk order',
        deliveryAllowance: 1500.5,
      });

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.content).toContain('₦1,499.99');
      expect(payload.content).not.toContain('1,500.50');
      expect(payload.data.allowanceAmount).toBe('1499.99');
      expect(payload.data.creditedAt).toBe('2026-08-23T09:39:58.000Z');
    });

    it('keeps sub-kobo precision rather than rounding it away', async () => {
      creditAllowance(1500.5678, new Date('2026-08-23T09:39:58.000Z'));

      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Bulk order',
        deliveryAllowance: 1500.5678,
      });

      expect(notifications.notify.mock.calls[0][0].content).toContain(
        '₦1,500.5678',
      );
    });

    it('does not double the full stop when the admin already ended the sentence', async () => {
      creditAllowance(2000, new Date('2026-08-23T09:39:58.000Z'));

      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Thanks for the bulk order.',
        deliveryAllowance: 2000,
      });

      const content = notifications.notify.mock.calls[0][0].content;
      expect(content).not.toContain('..');
      expect(content).toBe(
        'ADLAK: Thanks for the bulk order. Delivery allowance of ₦2,000.00 ' +
          'has been credited to your wallet.',
      );
    });

    it('tells the distributor nothing when the wallet credit fails', async () => {
      prisma.$transaction.mockRejectedValue(new Error('wallet write failed'));

      await expect(
        service.sendIndividual('admin-1', {
          customerId: 'cust-1',
          message: 'Bulk order',
          deliveryAllowance: 1500.5,
        }),
      ).rejects.toThrow('wallet write failed');

      // The credit is what the message announces — announcing it after a
      // failed write would tell a distributor about money that is not there.
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('credits the wallet before the notification is written', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(() => {
        order.push('credit');
        return Promise.resolve([
          { id: 'cust-1' },
          {
            id: 'pay-1',
            amount: 1500.5,
            date: new Date('2026-08-23T09:39:58.000Z'),
          },
        ]);
      });
      notifications.notify.mockImplementation(() => {
        order.push('notify');
        return Promise.resolve(undefined);
      });

      await service.sendIndividual('admin-1', {
        customerId: 'cust-1',
        message: 'Bulk order',
        deliveryAllowance: 1500.5,
      });

      // A distributor who opens the app on the push must find the money there.
      expect(order).toEqual(['credit', 'notify']);
    });
  });
});
