import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { RealtimeService } from '../../infrastructure/realtime/realtime.service';
import { ChatService } from './chat.service';

/**
 * C-1 — the admin dashboard's "Unread Messages" tile could not come down.
 *
 * `unReadMessage` counts CUSTOMER-authored messages with `readAt: null`
 * (see AdminService.getDashboardStats). Nothing ever stamped those rows —
 * `markCustomerThreadRead` stamps STAFF-authored ones, which is the
 * distributor's side — so the counter only ever rose.
 */
describe('Staff-side chat read state (C-1)', () => {
  let service: ChatService;

  const prisma = {
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'c-1', region: 'LAGOS' }),
    },
    message: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: RealtimeService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = module.get(ChatService);
  });

  afterEach(() => jest.clearAllMocks());

  /** The update that clears the dashboard tile. */
  const readMarkingCall = () =>
    prisma.message.updateMany.mock.calls.find(
      (c) => c[0]?.where?.senderType === 'CUSTOMER',
    )?.[0];

  describe('PATCH /chat/{customerId}/read', () => {
    it('stamps the distributor’s unread messages and reports the count', async () => {
      const result = await service.markStaffThreadRead(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
      );

      expect(result).toEqual({ customerId: 'c-1', markedRead: 3 });
      expect(readMarkingCall()).toEqual({
        where: { customerId: 'c-1', senderType: 'CUSTOMER', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('is idempotent — a second call reports nothing left to mark', async () => {
      prisma.message.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.markStaffThreadRead(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
      );

      expect(result.markedRead).toBe(0);
    });

    it('never touches the distributor’s own side of the thread', async () => {
      // Stamping STAFF-authored rows here would silently mark the customer's
      // app as having read messages they have not seen.
      await service.markStaffThreadRead(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
      );

      const staffSide = prisma.message.updateMany.mock.calls.find(
        (c) => c[0]?.where?.senderType === 'STAFF',
      );
      expect(staffSide).toBeUndefined();
    });

    it('refuses an officer who is not assigned to the customer', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.markStaffThreadRead(
          { id: 'officer-9', role: 'OFFICER' },
          'c-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });

    it('holds a REGIONAL_ADMIN to their own region', async () => {
      prisma.customer.findUnique.mockResolvedValueOnce({
        id: 'c-1',
        region: 'NORTH',
      });

      await expect(
        service.markStaffThreadRead(
          { id: 'ra-1', role: 'REGIONAL_ADMIN', region: 'LAGOS' },
          'c-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });

    it('sends a CUSTOMER to their own route instead of clearing the wrong side', async () => {
      await expect(
        service.markStaffThreadRead({ id: 'c-1', role: 'CUSTOMER' }, 'c-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.message.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reading the thread marks it read', () => {
    it('clears the count when an admin opens the conversation', async () => {
      await service.getMessages({ id: 'admin-1', role: 'ADMIN' }, 'c-1');

      expect(readMarkingCall()).toBeDefined();
    });

    it('clears the count when the assigned officer opens it', async () => {
      await service.getMessages({ id: 'officer-1', role: 'OFFICER' }, 'c-1');

      expect(readMarkingCall()).toBeDefined();
    });

    it('does not mark anything when a distributor opens their own thread', async () => {
      // A customer reading their thread must not clear the staff-side unread
      // count — that is what the dashboard tile is measuring.
      await service.getMessages({ id: 'c-1', role: 'CUSTOMER' }, 'officer-1');

      expect(readMarkingCall()).toBeUndefined();
    });
  });
});
