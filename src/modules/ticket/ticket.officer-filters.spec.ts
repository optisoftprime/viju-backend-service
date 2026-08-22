import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { TicketService } from './ticket.service';
import { OfficerTicketsFilterDto } from './dto/ticket.dto';

/**
 * AO-T1 - GET /tickets/officer narrows by customer and by status.
 *
 * The Tickets tab lives inside one distributor's detail view, and the Open
 * Tickets tile needs AN UNRESOLVED ticket rather than merely the newest one.
 * Both filters run in SQL so meta.total counts the filtered set - narrowing a
 * page in the browser is what made the pager disagree with the rows.
 */
describe('Officer ticket filters (AO-T1)', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      supportTicket: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
      ...overrides,
    };
    const service = new TicketService(
      prisma as never,
      { notify: jest.fn() } as never,
      { publish: jest.fn() } as never,
    );
    return { prisma, service };
  };

  const portfolio = {
    OR: [
      { assignedOfficerId: 'o-1' },
      { officerAssignments: { some: { staffId: 'o-1' } } },
    ],
  };

  describe('customerId', () => {
    it('narrows to one distributor, in the COUNT as well as the page', async () => {
      const { service, prisma } = build();

      const res = await service.getAssignedTickets('o-1', {
        page: 1,
        pageSize: 20,
        customerId: 'c-1',
      });

      const expected = { customer: portfolio, customerId: 'c-1' };
      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: expected,
      });
      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      // meta.total is that customer's ticket count, not the officer's.
      expect(res.meta.total).toBe(2);
    });

    it('rejects a distributor outside the caller portfolio', async () => {
      // An empty list would read as "no tickets" and hide the mistake.
      const { service, prisma } = build({
        customer: { findFirst: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.getAssignedTickets('o-1', {
          page: 1,
          pageSize: 20,
          customerId: 'someone-elses',
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'VALIDATION_ERROR',
          message: 'customerId does not match a distributor assigned to you',
        },
      });
      expect(prisma.supportTicket.count).not.toHaveBeenCalled();
    });

    it('checks assignment against the portfolio, not just the id', async () => {
      const { service, prisma } = build();

      await service.getAssignedTickets('o-1', {
        page: 1,
        pageSize: 20,
        customerId: 'c-1',
      });

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { AND: [{ id: 'c-1' }, portfolio] },
        select: { id: true },
      });
    });

    it('skips the lookup entirely when no customerId is sent', async () => {
      const { service, prisma } = build();

      await service.getAssignedTickets('o-1', { page: 1, pageSize: 20 });

      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: { customer: portfolio },
      });
    });
  });

  describe('status', () => {
    it('narrows to the unresolved statuses, counted into meta.total', async () => {
      const { service, prisma } = build();

      await service.getAssignedTickets('o-1', {
        page: 1,
        pageSize: 20,
        status: ['OPEN', 'IN_PROGRESS'],
      });

      const expected = {
        customer: portfolio,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      };
      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: expected,
      });
      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
    });

    it('combines with customerId', async () => {
      const { service, prisma } = build();

      await service.getAssignedTickets('o-1', {
        page: 1,
        pageSize: 20,
        customerId: 'c-1',
        status: ['OPEN'],
      });

      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: {
          customer: portfolio,
          customerId: 'c-1',
          status: { in: ['OPEN'] },
        },
      });
    });

    it('leaves the where-clause untouched when omitted', async () => {
      const { service, prisma } = build();

      await service.getAssignedTickets('o-1', { page: 1, pageSize: 20 });

      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: expect.not.objectContaining({ status: expect.anything() }),
      });
    });
  });

  describe('status parsing matches GET /admin/audit/tickets exactly', () => {
    const parse = (value: unknown) =>
      plainToInstance(OfficerTicketsFilterDto, { status: value });

    it('accepts a comma-separated list', () => {
      expect(parse('OPEN,IN_PROGRESS').status).toEqual(['OPEN', 'IN_PROGRESS']);
    });

    it('accepts a repeated param and de-duplicates', () => {
      expect(parse(['OPEN', 'OPEN', 'RESOLVED']).status).toEqual([
        'OPEN',
        'RESOLVED',
      ]);
    });

    it('is case-insensitive and trims', () => {
      expect(parse(' open , in_progress ').status).toEqual([
        'OPEN',
        'IN_PROGRESS',
      ]);
    });

    it('stays undefined when omitted, so the default is every status', () => {
      expect(parse(undefined).status).toBeUndefined();
      expect(parse('').status).toBeUndefined();
    });

    it('rejects an unknown value with the message the page renders', () => {
      expect(() => parse('CLOSED')).toThrow(BadRequestException);
      try {
        parse('OPEN,CLOSED');
      } catch (e) {
        expect((e as BadRequestException).getResponse()).toMatchObject({
          message:
            'status must be one of: OPEN, IN_PROGRESS, AWAITING_CUSTOMER, RESOLVED',
          code: 'VALIDATION_ERROR',
        });
      }
    });
  });

  describe('row shape', () => {
    it('carries repliesCount and the widened customer summary', async () => {
      const { service } = build({
        supportTicket: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 't-1',
              ticketId: 'TCK-00123',
              customerId: 'c-1',
              subject: 'Wallet not credited',
              status: 'OPEN',
              customer: {
                id: 'c-1',
                erpId: '10110003',
                name: 'ADLAK',
                phone: '+2348168584112',
                email: null,
              },
              _count: { replies: 1 },
            },
          ]),
        },
      });

      const res = await service.getAssignedTickets('o-1', {
        page: 1,
        pageSize: 20,
      });

      expect(res.data[0]).toMatchObject({
        ticketId: 'TCK-00123',
        repliesCount: 1,
        customer: { id: 'c-1', erpId: '10110003', phone: '+2348168584112' },
      });
      // The raw relation count is not leaked alongside the friendly field.
      expect(res.data[0]).not.toHaveProperty('_count');
    });
  });
});
