import { NotFoundException } from '@nestjs/common';
import { CustomerService } from './customer.service';

/**
 * GET /customers/me/chats — the distributor's account officers as a chat list.
 *
 * The mirror of GET /officers/chats, with two deliberate differences: it NAMES
 * the officer (PRD F6 applies everywhere else), and it lists officers the
 * distributor has never messaged, because the point is to choose someone to
 * start a conversation with.
 */
describe('Customer officer chat list', () => {
  const officer = (id: string, name: string, extra = {}) => ({
    id,
    name,
    profilePhotoUrl: null,
    isActive: true,
    ...extra,
  });

  const build = (opts: {
    assignments?: unknown[];
    customer?: unknown;
    lastAt?: unknown[];
    unread?: unknown[];
    previews?: unknown[];
  }) => {
    const prisma = {
      customerOfficer: {
        findMany: jest.fn().mockResolvedValue(opts.assignments ?? []),
      },
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.customer === undefined
              ? { assignedOfficerId: null, assignedOfficer: null }
              : opts.customer,
          ),
      },
      message: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce(opts.lastAt ?? [])
          .mockResolvedValueOnce(opts.unread ?? []),
      },
      $queryRaw: jest.fn().mockResolvedValue(opts.previews ?? []),
    };
    return {
      prisma,
      service: new CustomerService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('names the officer — PRD F6 does not apply here', async () => {
    const { service } = build({
      assignments: [{ isPrimary: true, staff: officer('o-1', 'Ifeanyi Okon') }],
    });

    const rows = await service.getOfficerChats('c-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ifeanyi Okon');
    expect(rows[0].officerId).toBe('o-1');
  });

  it('lists an officer the distributor has never messaged', async () => {
    // The officer version omits empty threads; this one must not, or there is
    // no way to start a first conversation.
    const { service } = build({
      assignments: [{ isPrimary: true, staff: officer('o-1', 'Ifeanyi Okon') }],
    });

    const rows = await service.getOfficerChats('c-1');

    expect(rows[0]).toMatchObject({
      lastMessagePreview: null,
      lastMessageSenderType: null,
      lastMessageAt: null,
      unreadMessages: 0,
    });
  });

  it('lists every assigned officer, primary and secondary', async () => {
    const { service } = build({
      assignments: [
        { isPrimary: true, staff: officer('o-1', 'Primary Pat') },
        { isPrimary: false, staff: officer('o-2', 'Secondary Sam') },
      ],
    });

    const rows = await service.getOfficerChats('c-1');
    expect(rows.map((r) => r.officerId).sort()).toEqual(['o-1', 'o-2']);
  });

  it('includes the primary pointer even with no CustomerOfficer row', async () => {
    // A reassignment writes Customer.assignedOfficerId first; the join row can
    // lag. The distributor must still see who to write to.
    const { service } = build({
      assignments: [],
      customer: {
        assignedOfficerId: 'o-9',
        assignedOfficer: officer('o-9', 'Newly Assigned'),
      },
    });

    const rows = await service.getOfficerChats('c-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ officerId: 'o-9', isPrimary: true });
  });

  it('marks exactly one officer primary, from the pointer', async () => {
    const { service } = build({
      assignments: [
        { isPrimary: false, staff: officer('o-1', 'Pat') },
        { isPrimary: false, staff: officer('o-2', 'Sam') },
      ],
      customer: {
        assignedOfficerId: 'o-2',
        assignedOfficer: officer('o-2', 'Sam'),
      },
    });

    const rows = await service.getOfficerChats('c-1');
    expect(rows.filter((r) => r.isPrimary).map((r) => r.officerId)).toEqual([
      'o-2',
    ]);
  });

  it('omits a deactivated officer — they cannot reply', async () => {
    const { service } = build({
      assignments: [
        { isPrimary: true, staff: officer('o-1', 'Active Ann') },
        {
          isPrimary: false,
          staff: officer('o-2', 'Retired Rex', { isActive: false }),
        },
      ],
    });

    const rows = await service.getOfficerChats('c-1');
    expect(rows.map((r) => r.officerId)).toEqual(['o-1']);
  });

  it('returns an empty list when nobody is assigned', async () => {
    const { service } = build({ assignments: [] });
    await expect(service.getOfficerChats('c-1')).resolves.toEqual([]);
  });

  it('404s an unknown customer', async () => {
    const { service } = build({ assignments: [], customer: null });
    await expect(service.getOfficerChats('nobody')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('per-officer thread data', () => {
    const twoOfficers = {
      assignments: [
        { isPrimary: true, staff: officer('o-1', 'Pat') },
        { isPrimary: false, staff: officer('o-2', 'Sam') },
      ],
    };

    it('scopes preview, time and unread to each officer separately', async () => {
      const { service } = build({
        ...twoOfficers,
        lastAt: [
          {
            staffId: 'o-1',
            _max: { createdAt: new Date('2026-08-28T08:00:00Z') },
          },
          {
            staffId: 'o-2',
            _max: { createdAt: new Date('2026-08-27T08:00:00Z') },
          },
        ],
        unread: [{ staffId: 'o-2', _count: { _all: 3 } }],
        previews: [
          {
            staffId: 'o-1',
            content: 'Waybill ready.',
            attachmentUrl: null,
            senderType: 'STAFF',
          },
          {
            staffId: 'o-2',
            content: 'Any update?',
            attachmentUrl: null,
            senderType: 'CUSTOMER',
          },
        ],
      });

      const rows = await service.getOfficerChats('c-1');
      const pat = rows.find((r) => r.officerId === 'o-1')!;
      const sam = rows.find((r) => r.officerId === 'o-2')!;

      expect(pat).toMatchObject({
        lastMessagePreview: 'Waybill ready.',
        lastMessageSenderType: 'STAFF',
        unreadMessages: 0,
      });
      expect(sam).toMatchObject({
        lastMessagePreview: 'Any update?',
        lastMessageSenderType: 'CUSTOMER',
        unreadMessages: 3,
      });
    });

    it('counts unread as messages the OFFICER sent — the mirror of the officer list', async () => {
      const { service, prisma } = build(twoOfficers);

      await service.getOfficerChats('c-1');

      expect(prisma.message.groupBy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'c-1',
            senderType: 'STAFF',
            readAt: null,
          }),
        }),
      );
    });

    it('sorts most recently active first', async () => {
      const { service } = build({
        ...twoOfficers,
        lastAt: [
          {
            staffId: 'o-1',
            _max: { createdAt: new Date('2026-08-20T08:00:00Z') },
          },
          {
            staffId: 'o-2',
            _max: { createdAt: new Date('2026-08-28T08:00:00Z') },
          },
        ],
      });

      const rows = await service.getOfficerChats('c-1');
      expect(rows.map((r) => r.officerId)).toEqual(['o-2', 'o-1']);
    });

    it('sinks never-messaged officers below active threads, primary first', async () => {
      const { service } = build({
        assignments: [
          { isPrimary: false, staff: officer('o-quiet-b', 'Zoe') },
          { isPrimary: true, staff: officer('o-quiet-a', 'Primary Pat') },
          { isPrimary: false, staff: officer('o-busy', 'Busy Ben') },
        ],
        lastAt: [
          {
            staffId: 'o-busy',
            _max: { createdAt: new Date('2026-08-28T08:00:00Z') },
          },
        ],
      });

      const rows = await service.getOfficerChats('c-1');
      expect(rows.map((r) => r.officerId)).toEqual([
        'o-busy',
        'o-quiet-a',
        'o-quiet-b',
      ]);
    });
  });
});
