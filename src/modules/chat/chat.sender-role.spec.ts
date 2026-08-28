import { ChatService } from './chat.service';
import { TicketService } from '../ticket/ticket.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';

/**
 * S-1 - a staff-authored message names its author, so a thread can show
 * "Admin" or "Regional Admin" rather than a flat "Staff".
 *
 * N-1 - a CHAT_MESSAGE row is written for exactly one recipient: the staff
 * member the conversation belongs to.
 */
describe('Sender role and chat notification scoping (S-1, N-1)', () => {
  const STAFF_SELECT = { id: true, name: true, role: true };

  const staffMessage = {
    id: 'm-1',
    customerId: 'c-1',
    staffId: 'admin-1',
    senderType: 'STAFF',
    content: 'Looking into it now.',
    attachmentUrl: null,
    createdAt: new Date('2026-08-22T09:05:00.000Z'),
    readAt: null,
    staff: { id: 'admin-1', name: 'Chidi Nwosu', role: 'ADMIN' },
  };

  const customerMessage = {
    id: 'm-2',
    customerId: 'c-1',
    // Set even on a customer-authored row: it is the officer the message was
    // routed TO, which is exactly why `staff` must be nulled here.
    staffId: 'o-1',
    senderType: 'CUSTOMER',
    content: 'Thank you.',
    attachmentUrl: null,
    createdAt: new Date('2026-08-22T09:06:00.000Z'),
    readAt: null,
    staff: { id: 'o-1', name: 'Ifeanyi Okon', role: 'OFFICER' },
  };

  const build = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c-1', region: 'LAGOS', name: 'ADLAK' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      customerOfficer: { findMany: jest.fn().mockResolvedValue([]) },
      message: {
        findMany: jest.fn().mockResolvedValue([staffMessage, customerMessage]),
        create: jest.fn().mockResolvedValue(staffMessage),
        // C-1 — reading a thread as staff stamps the distributor's messages
        // read, so the dashboard's unread tile can fall.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ...overrides,
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const realtime = { publish: jest.fn() };
    return {
      prisma,
      notifications,
      realtime,
      service: new ChatService(
        prisma as never,
        notifications as never,
        realtime as never,
      ),
    };
  };

  describe('S-1 - staff author on chat messages', () => {
    it('names the author on a staff message read by staff', async () => {
      const { service } = build();

      const thread = await service.getMessages(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
      );

      expect(thread[0].staff).toEqual({
        id: 'admin-1',
        name: 'Chidi Nwosu',
        role: 'ADMIN',
      });
    });

    it('nulls the block on a customer-authored message', async () => {
      // The row still carries a staffId - the officer it was routed to - and
      // naming them as the sender would be wrong.
      const { service } = build();

      const thread = await service.getMessages(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
      );

      expect(thread[1].senderType).toBe('CUSTOMER');
      expect(thread[1].staff).toBeNull();
    });

    it('names the author on an officer-read thread too', async () => {
      const { service, prisma } = build();

      await service.getMessages({ id: 'o-1', role: 'OFFICER' }, 'c-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { staff: { select: STAFF_SELECT } },
        }),
      );
    });

    it('names the author to a CUSTOMER caller too', async () => {
      // Officers are named to distributors now. GET /customers/me/chats sends
      // them to GET /chat/{officerId}, so suppressing the author on that very
      // thread would leave every message unattributed.
      const { service, prisma } = build();

      const thread = await service.getMessages(
        { id: 'c-1', role: 'CUSTOMER' },
        'o-1',
      );

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { staff: { select: STAFF_SELECT } },
        }),
      );
      // The staff block is still nulled on a CUSTOMER-authored row, whose
      // staffId names the officer it was routed TO rather than its author.
      expect(thread[0].staff).toEqual({
        id: 'admin-1',
        name: 'Chidi Nwosu',
        role: 'ADMIN',
      });
      expect(thread[1].staff).toBeNull();
    });

    it('echoes the author on the message it just created', async () => {
      const { service } = build();

      const created = await service.sendMessage(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
        { content: 'Looking into it now.' },
      );

      expect(created.staff).toEqual({
        id: 'admin-1',
        name: 'Chidi Nwosu',
        role: 'ADMIN',
      });
    });
  });

  describe('N-1 - one recipient per CHAT_MESSAGE row', () => {
    it('notifies only the officer the message was addressed to', async () => {
      // Customer B writes to officer A. Officer C is a secondary on the same
      // account and must not see the row at all.
      const { service, notifications } = build();

      await service.sendMessage({ id: 'c-1', role: 'CUSTOMER' }, 'o-1', {
        content: 'Any update?',
      });

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'STAFF',
          recipientId: 'o-1',
          subjectCustomerId: 'c-1',
          type: 'CHAT_MESSAGE',
        }),
      );
    });

    it('publishes the live frame to that one recipient as well', async () => {
      const { service, realtime } = build();

      await service.sendMessage({ id: 'c-1', role: 'CUSTOMER' }, 'o-1', {
        content: 'Any update?',
      });

      const staffFrames = realtime.publish.mock.calls
        .map((c) => c[0])
        .filter((f) => f.recipientType === 'STAFF');
      expect(staffFrames).toHaveLength(1);
      expect(staffFrames[0].recipientId).toBe('o-1');
    });

    it('routes a customer-portal message to the primary officer only', async () => {
      const { service, notifications } = build({
        customerOfficer: {
          findMany: jest.fn().mockResolvedValue([
            { staffId: 'o-primary', isPrimary: true },
            { staffId: 'o-secondary', isPrimary: false },
          ]),
        },
      });

      await service.sendFromCustomer('c-1', { content: 'Any update?' });

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'o-primary',
          subjectCustomerId: 'c-1',
        }),
      );
    });

    it('notifies only the distributor when staff write', async () => {
      const { service, notifications } = build();

      await service.sendMessage({ id: 'admin-1', role: 'ADMIN' }, 'c-1', {
        content: 'Looking into it now.',
      });

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      // The push now NAMES the sender. It used to read 'Viju Account Officer'
      // for everyone, which a distributor with two officers could not act on.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'CUSTOMER',
          recipientId: 'c-1',
          title: 'Chidi Nwosu',
        }),
      );
    });
  });

  describe('S-1 - staff author on ticket replies', () => {
    const ticketWithReplies = {
      id: 't-1',
      ticketId: 'TCK-00123',
      customerId: 'c-1',
      subject: 'Wallet not credited',
      status: 'OPEN',
      customer: { id: 'c-1', region: 'LAGOS', assignedOfficerId: 'o-1' },
      replies: [
        {
          id: 'r-1',
          senderType: 'STAFF',
          staffId: 'o-1',
          staff: { id: 'o-1', name: 'Ifeanyi Okon', role: 'OFFICER' },
          content: 'Checking with finance now.',
        },
        {
          id: 'r-2',
          senderType: 'STAFF',
          staffId: 'ra-1',
          staff: { id: 'ra-1', name: 'Chidi Nwosu', role: 'REGIONAL_ADMIN' },
          content: 'Escalated to finance.',
        },
        {
          id: 'r-3',
          senderType: 'CUSTOMER',
          staffId: null,
          staff: null,
          content: 'Thank you.',
        },
      ],
    };

    const ticketService = () => {
      const prisma = {
        supportTicket: {
          findUnique: jest.fn().mockResolvedValue(ticketWithReplies),
        },
        customerOfficer: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      return {
        prisma,
        service: new TicketService(
          prisma as never,
          { notify: jest.fn() } as never,
          { publish: jest.fn() } as never,
        ),
      };
    };

    it('distinguishes the officer from the regional admin who stepped in', async () => {
      const { service } = ticketService();

      const thread = await service.getTicket('t-1', {
        id: 'admin-1',
        role: 'ADMIN',
      });

      expect(thread.replies[0].staff).toMatchObject({ role: 'OFFICER' });
      expect(thread.replies[1].staff).toMatchObject({
        name: 'Chidi Nwosu',
        role: 'REGIONAL_ADMIN',
      });
    });

    it('nulls the block on a customer-authored reply', async () => {
      const { service } = ticketService();

      const thread = await service.getTicket('t-1', {
        id: 'admin-1',
        role: 'ADMIN',
      });

      expect(thread.replies[2].staff).toBeNull();
    });

    it('selects the author in the query, not just at the edge', async () => {
      const { service, prisma } = ticketService();

      await service.getTicket('t-1', { id: 'admin-1', role: 'ADMIN' });

      expect(prisma.supportTicket.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            replies: expect.objectContaining({
              include: { staff: { select: STAFF_SELECT } },
            }),
          }),
        }),
      );
    });
  });

  describe('N-1 - notify() addresses the row correctly', () => {
    const notifyWith = async (payload: Record<string, unknown>) => {
      const prisma = {
        notification: {
          create: jest.fn().mockResolvedValue({ id: 'n-1', type: 'X' }),
        },
        pushToken: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new NotificationService(
        prisma as never,
        { dispatch: jest.fn() },
        { publish: jest.fn() } as never,
      );
      await service.notify(payload as never);
      return prisma.notification.create.mock.calls[0][0].data;
    };

    it('sets staffId to the recipient and customerId to the subject', async () => {
      const data = await notifyWith({
        recipientType: 'STAFF',
        recipientId: 'o-1',
        subjectCustomerId: 'c-1',
        title: 'New message from ADLAK',
        body: 'Any update?',
        type: 'CHAT_MESSAGE',
      });

      expect(data).toMatchObject({ staffId: 'o-1', customerId: 'c-1' });
    });

    it('leaves customerId null on a staff row with no distributor in play', async () => {
      const data = await notifyWith({
        recipientType: 'STAFF',
        recipientId: 'o-1',
        title: 'Something',
        body: 'else',
      });

      expect(data).toMatchObject({ staffId: 'o-1', customerId: null });
    });

    it('never lets a subject id hijack a customer-bound row', async () => {
      const data = await notifyWith({
        recipientType: 'CUSTOMER',
        recipientId: 'c-1',
        subjectCustomerId: 'someone-else',
        title: 'Viju Account Officer',
        body: 'hello',
      });

      expect(data).toMatchObject({ customerId: 'c-1', staffId: null });
    });
  });
});
