import { Reflector } from '@nestjs/core';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketController } from './ticket.controller';
import { TicketService } from './ticket.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Region } from '../../common/region/region.constants';

/**
 * AD-T1 — an ADMIN opens ticket threads from the Interaction Audit "Ticket"
 * tab, replies and changes the status, exactly as the assigned account officer
 * does. An admin is never the assigned officer, so any assignment check on
 * these routes would answer 403 for every ticket in the audit.
 *
 * A REGIONAL_ADMIN gets the same three routes, scoped to their own region —
 * the rule already applied to GET /admin/audit/chats (B-4.2).
 */
describe('Ticket access for ADMIN / REGIONAL_ADMIN (AD-T1)', () => {
  const reflector = new Reflector();

  const rolesFor = (method: keyof TicketController): string[] | undefined =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      TicketController.prototype[method] as () => unknown,
      TicketController,
    ]);

  describe('route authorisation', () => {
    it('admits ADMIN and REGIONAL_ADMIN on all three audit routes', () => {
      expect(rolesFor('getTicket')).toEqual([
        'CUSTOMER',
        'OFFICER',
        'ADMIN',
        'REGIONAL_ADMIN',
      ]);
      expect(rolesFor('replyToTicket')).toEqual([
        'CUSTOMER',
        'OFFICER',
        'ADMIN',
        'REGIONAL_ADMIN',
      ]);
      expect(rolesFor('updateStatus')).toEqual([
        'OFFICER',
        'ADMIN',
        'REGIONAL_ADMIN',
      ]);
    });
  });

  describe('service authorisation', () => {
    const ticket = (region: Region = Region.LAGOS) => ({
      id: 't-1',
      ticketId: 'TCK-00123',
      customerId: 'c-1',
      subject: 'Wallet not credited',
      status: 'OPEN',
      replies: [],
      customer: { id: 'c-1', region, assignedOfficerId: 'o-1' },
    });

    const build = (found: unknown) => {
      const prisma = {
        supportTicket: {
          findUnique: jest.fn().mockResolvedValue(found),
          update: jest.fn().mockResolvedValue({ ...(found as object) }),
        },
        ticketReply: { create: jest.fn().mockResolvedValue({ id: 'r-1' }) },
        customerOfficer: { findFirst: jest.fn().mockResolvedValue(null) },
        customer: {
          findUnique: jest.fn().mockResolvedValue({
            assignedOfficerId: 'o-1',
            officerAssignments: [],
          }),
        },
      };
      const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
      const realtime = { publish: jest.fn() };
      return {
        prisma,
        notifications,
        service: new TicketService(
          prisma as never,
          notifications as never,
          realtime as never,
        ),
      };
    };

    it('lets an ADMIN read a ticket they are not assigned to', async () => {
      const { service, prisma } = build(ticket());

      await expect(
        service.getTicket('t-1', { id: 'admin-1', role: 'ADMIN' }),
      ).resolves.toMatchObject({ ticketId: 'TCK-00123' });
      // No assignment lookup at all — an admin is never the assigned officer.
      expect(prisma.customerOfficer.findFirst).not.toHaveBeenCalled();
    });

    it('still refuses an OFFICER who does not hold the customer', async () => {
      const { service } = build(ticket());

      await expect(
        service.getTicket('t-1', { id: 'other-officer', role: 'OFFICER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('holds a REGIONAL_ADMIN to their own region', async () => {
      const { service } = build(ticket(Region.LAGOS));

      await expect(
        service.getTicket('t-1', {
          id: 'ra-1',
          role: 'REGIONAL_ADMIN',
          region: Region.LAGOS,
        }),
      ).resolves.toBeDefined();

      await expect(
        service.getTicket('t-1', {
          id: 'ra-2',
          role: 'REGIONAL_ADMIN',
          region: Region.NORTH,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s an unknown ticket before any role check', async () => {
      const { service } = build(null);

      await expect(
        service.getTicket('nope', { id: 'admin-1', role: 'ADMIN' }),
      ).rejects.toThrow(NotFoundException);
    });

    it("credits an admin's reply to the admin, not the assigned officer", async () => {
      const { service, prisma } = build(ticket());

      await service.replyToTicket(
        't-1',
        { id: 'admin-1', role: 'ADMIN' },
        { content: 'Finance has credited the wallet.' },
      );

      expect(prisma.ticketReply.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          senderType: 'STAFF',
          staffId: 'admin-1',
          customerId: null,
        }),
      });
    });

    it('returns the whole thread with the new reply appended', async () => {
      const withReply = {
        ...ticket(),
        replies: [{ id: 'r-1', content: 'Finance has credited the wallet.' }],
      };
      const { service } = build(withReply);

      const res = await service.replyToTicket(
        't-1',
        { id: 'admin-1', role: 'ADMIN' },
        { content: 'Finance has credited the wallet.' },
      );

      // The modal re-renders straight from this rather than refetching.
      expect(res).toMatchObject({ ticketId: 'TCK-00123', status: 'OPEN' });
      expect(res.replies).toHaveLength(1);
      expect(res.reply).toMatchObject({ id: 'r-1' });
    });

    it('records a customer reply against the customer, unchanged', async () => {
      const { service, prisma } = build({
        ...ticket(),
        customerId: 'c-1',
      });

      await service.replyToTicket(
        't-1',
        { id: 'c-1', role: 'CUSTOMER' },
        { content: 'Any update?' },
      );

      expect(prisma.ticketReply.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          senderType: 'CUSTOMER',
          customerId: 'c-1',
          staffId: null,
        }),
      });
    });

    it('lets an ADMIN change the status without being the assigned officer', async () => {
      const { service, prisma } = build(ticket());

      await service.updateStatus(
        't-1',
        { id: 'admin-1', role: 'ADMIN' },
        { status: 'IN_PROGRESS' },
      );

      expect(prisma.supportTicket.update).toHaveBeenCalledWith({
        where: { id: 't-1' },
        data: { status: 'IN_PROGRESS' },
      });
    });

    it('refuses a status change from a REGIONAL_ADMIN outside their region', async () => {
      const { service } = build(ticket(Region.LAGOS));

      await expect(
        service.updateStatus(
          't-1',
          { id: 'ra-2', role: 'REGIONAL_ADMIN', region: Region.NORTH },
          { status: 'RESOLVED' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
