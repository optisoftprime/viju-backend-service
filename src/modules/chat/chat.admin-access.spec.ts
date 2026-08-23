import { Reflector } from '@nestjs/core';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Region } from '../../common/region/region.constants';

/**
 * AD-C1 — an ADMIN opens a chat thread from the Interaction Audit "Chat" tab
 * and replies to the customer, exactly as the assigned officer does. The audit
 * row carries at most the 200 most recent messages and is read-only, so the
 * modal reads the live thread from GET /chat/{customerId} and writes through
 * POST /chat/{customerId}.
 *
 * The message an admin sends carries the ADMIN's own staffId, so the audit
 * trail shows who actually replied rather than crediting the assigned officer.
 */
describe('Chat access for ADMIN / REGIONAL_ADMIN (AD-C1)', () => {
  const reflector = new Reflector();

  const rolesFor = (method: keyof ChatController): string[] | undefined =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ChatController.prototype[method] as () => unknown,
      ChatController,
    ]);

  it('admits ADMIN and REGIONAL_ADMIN on both thread routes', () => {
    expect(rolesFor('getMessages')).toEqual([
      'CUSTOMER',
      'OFFICER',
      'ADMIN',
      'REGIONAL_ADMIN',
    ]);
    expect(rolesFor('sendMessage')).toEqual([
      'CUSTOMER',
      'OFFICER',
      'ADMIN',
      'REGIONAL_ADMIN',
    ]);
  });

  it('admits REGIONAL_ADMIN on the read-only audit route too', () => {
    expect(rolesFor('auditCustomerChats')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
  });

  it('keeps the customer-facing routes customer-only', () => {
    // PRD F6 — a distributor never sees individual officer names, so these
    // stay off the staff surface entirely.
    expect(rolesFor('getMyThread')).toEqual(['CUSTOMER']);
    expect(rolesFor('sendFromCustomer')).toEqual(['CUSTOMER']);
  });

  describe('service authorisation', () => {
    const build = (customer: unknown) => {
      const prisma = {
        customer: { findUnique: jest.fn().mockResolvedValue(customer) },
        message: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: 'm-1',
            customerId: 'c-1',
            staffId: 'admin-1',
            senderType: 'STAFF',
            content: 'Looking into it now.',
            attachmentUrl: null,
            createdAt: new Date('2026-08-22T09:05:00.000Z'),
            readAt: null,
          }),
          // C-1 — reading a thread as staff stamps the distributor's messages
          // read, so the dashboard's unread tile can fall.
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

    const lagosCustomer = { id: 'c-1', region: Region.LAGOS };

    it('gives an ADMIN the whole thread for any customer', async () => {
      const { service, prisma } = build(lagosCustomer);

      await service.getMessages({ id: 'admin-1', role: 'ADMIN' }, 'c-1');

      // Every message on the account, oldest first — a reassignment must not
      // hide history, and the payload is a bare array, not an envelope.
      // S-1: staff callers also get the author of each staff message.
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { customerId: 'c-1' },
        orderBy: { createdAt: 'asc' },
        include: {
          staff: { select: { id: true, name: true, role: true } },
        },
      });
    });

    it('holds a REGIONAL_ADMIN to their own region', async () => {
      const { service } = build(lagosCustomer);

      await expect(
        service.getMessages(
          { id: 'ra-1', role: 'REGIONAL_ADMIN', region: Region.LAGOS },
          'c-1',
        ),
      ).resolves.toEqual([]);

      await expect(
        service.getMessages(
          { id: 'ra-2', role: 'REGIONAL_ADMIN', region: Region.NORTH },
          'c-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s an unknown customer', async () => {
      const { service } = build(null);

      await expect(
        service.getMessages({ id: 'admin-1', role: 'ADMIN' }, 'nope'),
      ).rejects.toThrow(NotFoundException);
    });

    it("attributes an admin's reply to the admin's own staffId", async () => {
      const { service, prisma } = build(lagosCustomer);

      const created = await service.sendMessage(
        { id: 'admin-1', role: 'ADMIN' },
        'c-1',
        { content: 'Looking into it now.' },
      );

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          customerId: 'c-1',
          staffId: 'admin-1',
          senderType: 'STAFF',
          content: 'Looking into it now.',
          attachmentUrl: null,
        },
        // S-1 - the created row names its author.
        include: {
          staff: { select: { id: true, name: true, role: true } },
        },
      });
      // The single created message, not an envelope and not the whole thread.
      expect(created).toMatchObject({ id: 'm-1', senderType: 'STAFF' });
    });

    it('still shows the customer only the Viju Account Officer label', async () => {
      const { service, notifications } = build(lagosCustomer);

      await service.sendMessage({ id: 'admin-1', role: 'ADMIN' }, 'c-1', {
        content: 'Looking into it now.',
      });

      // PRD F6 — individual staff names are never exposed to a distributor,
      // whether the sender was the officer or an admin.
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'CUSTOMER',
          recipientId: 'c-1',
          title: 'Viju Account Officer',
        }),
      );
    });

    it('region-scopes the read-only audit route as well', async () => {
      const { service } = build(lagosCustomer);

      await expect(
        service.getAudits(
          { id: 'ra-2', role: 'REGIONAL_ADMIN', region: Region.NORTH },
          'c-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.getAudits({ id: 'admin-1', role: 'ADMIN' }, 'c-1'),
      ).resolves.toEqual([]);
    });

    it('refuses a regional admin writing outside their region', async () => {
      const { service, prisma } = build(lagosCustomer);

      await expect(
        service.sendMessage(
          { id: 'ra-2', role: 'REGIONAL_ADMIN', region: Region.NORTH },
          'c-1',
          { content: 'nope' },
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.message.create).not.toHaveBeenCalled();
    });
  });
});
