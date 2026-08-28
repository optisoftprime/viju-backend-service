import { ChatService } from './chat.service';

/**
 * Distributors now see their account officer's NAME.
 *
 * Every customer-facing surface used to render staff as the fixed label
 * 'Viju Account Officer' (PRD F6). A distributor who deals with more than one
 * officer could not tell their conversations apart, so the label is now the
 * officer's real name — on the merged thread and on the push notification.
 */
describe('Officer naming on customer-facing chat', () => {
  const build = (messages: unknown[], created?: unknown) => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c-1', name: 'ADLAK' }),
      },
      customerOfficer: { findMany: jest.fn().mockResolvedValue([]) },
      message: {
        findMany: jest.fn().mockResolvedValue(messages),
        create: jest.fn().mockResolvedValue(created ?? {}),
      },
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const realtime = { publish: jest.fn() };
    return {
      prisma,
      notifications,
      service: new ChatService(
        prisma as never,
        notifications as never,
        realtime as never,
      ),
    };
  };

  describe('GET /chat/me — the merged thread', () => {
    it('labels a staff message with the officer who wrote it', async () => {
      const { service } = build([
        {
          id: 'm-1',
          senderType: 'STAFF',
          content: 'Your waybill is ready.',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: { name: 'Ifeanyi Okon' },
        },
      ]);

      const thread = await service.getCustomerThread('c-1');
      expect(thread[0].senderLabel).toBe('Ifeanyi Okon');
    });

    it('tells two officers apart in one thread', async () => {
      // The whole reason the fixed label had to go.
      const { service } = build([
        {
          id: 'm-1',
          senderType: 'STAFF',
          content: 'First',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: { name: 'Ifeanyi Okon' },
        },
        {
          id: 'm-2',
          senderType: 'STAFF',
          content: 'Second',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: { name: 'Chidi Nwosu' },
        },
      ]);

      const thread = await service.getCustomerThread('c-1');
      expect(thread.map((m) => m.senderLabel)).toEqual([
        'Ifeanyi Okon',
        'Chidi Nwosu',
      ]);
    });

    it("keeps the distributor's own messages as 'You'", async () => {
      // A customer-authored row still carries a staffId — the officer it was
      // routed TO — so naming it with that name would credit the wrong author.
      const { service } = build([
        {
          id: 'm-1',
          senderType: 'CUSTOMER',
          content: 'Any update?',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: { name: 'Ifeanyi Okon' },
        },
      ]);

      const thread = await service.getCustomerThread('c-1');
      expect(thread[0].senderLabel).toBe('You');
    });

    it('never leaks the raw staff relation onto the row', async () => {
      const { service } = build([
        {
          id: 'm-1',
          senderType: 'STAFF',
          content: 'hi',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: { name: 'Ifeanyi Okon' },
        },
      ]);

      const thread = await service.getCustomerThread('c-1');
      expect(thread[0]).not.toHaveProperty('staff');
      expect(thread[0]).not.toHaveProperty('staffId');
    });

    it('falls back to the generic label when the staff row is missing', async () => {
      const { service } = build([
        {
          id: 'm-1',
          senderType: 'STAFF',
          content: 'orphaned',
          attachmentUrl: null,
          createdAt: new Date(),
          readAt: null,
          staff: null,
        },
      ]);

      const thread = await service.getCustomerThread('c-1');
      expect(thread[0].senderLabel).toBe('Viju Account Officer');
    });
  });

  describe('push notification', () => {
    it('titles the push with the sending officer name', async () => {
      const { service, notifications } = build([], {
        id: 'm-1',
        customerId: 'c-1',
        staffId: 'o-1',
        senderType: 'STAFF',
        content: 'Your waybill is ready.',
        attachmentUrl: null,
        createdAt: new Date(),
        readAt: null,
        staff: { id: 'o-1', name: 'Ifeanyi Okon', role: 'OFFICER' },
      });

      await service.sendMessage({ id: 'o-1', role: 'ADMIN' }, 'c-1', {
        content: 'Your waybill is ready.',
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'CUSTOMER',
          recipientId: 'c-1',
          title: 'Ifeanyi Okon',
        }),
      );
    });
  });
});
