import { Reflector } from '@nestjs/core';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { InteractionAuditFilterDto } from './dto/audit.dto';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Region } from '../../common/region/region.constants';

/**
 * RA-T1 — the regional admin Open Tickets page needs unresolved tickets only,
 * with `meta.total` counting the filtered set. Filtering in the browser makes
 * a page of 20 show as few as 2 rows while the pager reports hundreds.
 *
 * RA-T2 — REGIONAL_ADMIN is authorised on the ticket audit and always scoped
 * to their own region, whatever they send. It is the only source of
 * region-scoped tickets the portal has.
 *
 * AD-X1 — the chat CSV export exists, takes the same filters as the list, and
 * emits one row per conversation matching the Chat tab.
 */
describe('Interaction audit for REGIONAL_ADMIN (RA-T1, RA-T2, AD-X1)', () => {
  const reflector = new Reflector();

  const rolesFor = (method: keyof AuditController): string[] | undefined =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      AuditController.prototype[method] as () => unknown,
      AuditController,
    ]);

  describe('route authorisation (RA-T2)', () => {
    it('admits REGIONAL_ADMIN on both audits, list and CSV', () => {
      expect(rolesFor('searchTickets')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
      expect(rolesFor('exportTickets')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
      expect(rolesFor('searchChats')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
      expect(rolesFor('exportChats')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
    });

    it('leaves the controller default at ADMIN', () => {
      expect(reflector.get<string[]>(ROLES_KEY, AuditController)).toEqual([
        'ADMIN',
      ]);
    });
  });

  describe('region scoping (RA-T2)', () => {
    const seen: Array<Record<string, unknown>> = [];
    const controller = new AuditController({
      searchTickets: (filter: Record<string, unknown>) => {
        seen.push(filter);
        return Promise.resolve({ data: [], meta: {} });
      },
      exportTicketsCsv: (filter: Record<string, unknown>) => {
        seen.push(filter);
        return Promise.resolve('');
      },
    } as never);

    beforeEach(() => {
      seen.length = 0;
    });

    it("forces a regional admin onto their own token's region", async () => {
      await controller.searchTickets(
        { role: 'REGIONAL_ADMIN', region: Region.LAGOS },
        // Everything the caller could try to widen their scope with.
        { region: Region.NORTH, page: 1, pageSize: 20 },
      );

      expect(seen[0]).toMatchObject({ region: Region.LAGOS });
    });

    it('leaves an ADMIN free to filter by any region, or none', async () => {
      await controller.searchTickets(
        { role: 'ADMIN', region: null },
        {
          region: Region.NORTH,
          page: 1,
          pageSize: 20,
        },
      );

      expect(seen[0]).toMatchObject({ region: Region.NORTH });
    });

    it('refuses a regional admin whose record carries no region', async () => {
      // Falling through with `region: undefined` would hand a misconfigured
      // account every region at once.
      await expect(
        controller.searchTickets(
          { role: 'REGIONAL_ADMIN', region: null },
          {
            page: 1,
            pageSize: 20,
          },
        ),
      ).rejects.toMatchObject({ response: { code: 'REGION_NOT_SET' } });
      expect(seen).toHaveLength(0);
    });

    it('scopes the ticket CSV export the same way', async () => {
      const res = { setHeader: jest.fn(), send: jest.fn() };
      await controller.exportTickets(
        { role: 'REGIONAL_ADMIN', region: Region.LAGOS },
        { region: Region.NORTH, page: 1, pageSize: 20 },
        res as never,
      );

      expect(seen[0]).toMatchObject({ region: Region.LAGOS });
    });
  });

  describe('status filter (RA-T1)', () => {
    const parse = (value: unknown) =>
      plainToInstance(InteractionAuditFilterDto, { status: value });

    it('accepts a comma-separated list', () => {
      expect(parse('OPEN,IN_PROGRESS,AWAITING_CUSTOMER').status).toEqual([
        'OPEN',
        'IN_PROGRESS',
        'AWAITING_CUSTOMER',
      ]);
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

  describe('service filtering', () => {
    const buildService = (overrides: Record<string, unknown> = {}) => {
      const prisma = {
        supportTicket: {
          count: jest.fn().mockResolvedValue(37),
          findMany: jest.fn().mockResolvedValue([]),
        },
        message: { groupBy: jest.fn().mockResolvedValue([]) },
        customer: { findMany: jest.fn().mockResolvedValue([]) },
        staff: { findMany: jest.fn().mockResolvedValue([]) },
        ...overrides,
      };
      return { prisma, service: new AuditService(prisma as never) };
    };

    it('applies status to the COUNT as well as the page (RA-T1)', async () => {
      const { service, prisma } = buildService();

      const res = await service.searchTickets(
        { status: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER'] } as never,
        { page: 1, pageSize: 20 },
      );

      const expected = expect.objectContaining({
        status: { in: ['OPEN', 'IN_PROGRESS', 'AWAITING_CUSTOMER'] },
      });
      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: expected,
      });
      expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expected }),
      );
      // meta.total is the unresolved count, not the unfiltered one.
      expect(res.meta.total).toBe(37);
    });

    it('leaves the where-clause untouched when status is omitted', async () => {
      const { service, prisma } = buildService();

      await service.searchTickets({} as never, { page: 1, pageSize: 20 });

      expect(prisma.supportTicket.count).toHaveBeenCalledWith({
        where: expect.not.objectContaining({ status: expect.anything() }),
      });
    });

    it('returns an empty envelope for a region with no tickets, never a 404', async () => {
      const { service } = buildService({
        supportTicket: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      });

      const res = await service.searchTickets(
        { region: Region.NORTH } as never,
        { page: 1, pageSize: 20 },
      );

      expect(res.data).toEqual([]);
      expect(res.meta).toMatchObject({
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('chat CSV export (AD-X1)', () => {
    const buildService = (threads: unknown[]) => {
      const prisma = {
        message: { groupBy: jest.fn().mockResolvedValue(threads) },
        customer: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'c-1',
              name: 'ADLAK',
              erpId: '10110003',
              region: Region.LAGOS,
            },
          ]),
        },
        staff: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 's-1', name: 'Ifeanyi Okon' }]),
        },
      };
      return { prisma, service: new AuditService(prisma as never) };
    };

    it('emits the header the Chat tab exports, one row per conversation', async () => {
      const { service } = buildService([
        {
          customerId: 'c-1',
          staffId: 's-1',
          _count: { _all: 24 },
          _max: { createdAt: new Date('2026-08-18T16:40:00.000Z') },
        },
      ]);

      const csv = await service.exportChatsCsv({} as never);

      expect(csv.split('\n')).toEqual([
        'Customer,Customer Code,Account Officer,Region,Messages,Last Message',
        'ADLAK,10110003,Ifeanyi Okon,LAGOS,24,2026-08-18T16:40:00.000Z',
      ]);
    });

    it('returns the header row alone when nothing matches, never a 404', async () => {
      const { service } = buildService([]);

      await expect(service.exportChatsCsv({} as never)).resolves.toBe(
        'Customer,Customer Code,Account Officer,Region,Messages,Last Message',
      );
    });

    it('passes the list filters straight through to the query', async () => {
      const { service, prisma } = buildService([]);

      await service.exportChatsCsv({
        region: Region.LAGOS,
        customerId: 'c-1',
        officerId: 's-1',
        keyword: 'waybill',
        startDate: '2026-08-01T00:00:00Z',
      } as never);

      expect(prisma.message.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'c-1',
            staffId: 's-1',
            content: { contains: 'waybill', mode: 'insensitive' },
            customer: { region: Region.LAGOS },
          }),
        }),
      );
    });
  });
});
