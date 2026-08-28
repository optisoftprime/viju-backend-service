import { ForbiddenException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { BroadcastService } from '../broadcast/broadcast.service';

/**
 * Spec 40 — a REGIONAL_ADMIN gets the admin's screens, scoped to their region.
 *
 * These pin the LIMITS rather than the widening. The widening is asserted in
 * admin.authorization.spec.ts (which roles reach which route); what matters
 * here is what a regional admin still cannot do once they are through the
 * door — above all, mint or edit an ADMIN, which would let them escalate
 * themselves out of their own region entirely.
 */
describe('Regional admin parity limits (spec 40)', () => {
  const codeOf = (e: unknown): string | undefined => {
    const body = (e as { response?: unknown })?.response;
    return typeof body === 'object' && body !== null && 'code' in body
      ? String(body.code)
      : undefined;
  };

  /** Runs `fn` and returns the thrown error's `code`. */
  const codeFrom = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      return codeOf(e) ?? 'NO_CODE';
    }
    throw new Error('expected the call to be refused, but it resolved');
  };

  describe('RU-2 — creating a user', () => {
    const build = () => {
      const service = Object.create(AdminService.prototype) as AdminService;
      return service;
    };

    it.each(['ADMIN', 'REGIONAL_ADMIN'])(
      'refuses to create a %s with ROLE_NOT_ALLOWED',
      async (role) => {
        // The escalation guard. A regional admin who could mint an
        // administrator could put themselves outside their own region.
        const service = build();
        const code = await codeFrom(() =>
          service.createOfficer(
            {
              name: 'Mallory',
              email: 'm@viju.local',
              phone: '+2348012345678',
              password: 'Password123',
              role,
            },
            { id: 'ra-1' },
            'LAGOS',
          ),
        );
        expect(code).toBe('ROLE_NOT_ALLOWED');
      },
    );

    it('leaves an ADMIN able to create any managed role', async () => {
      // No scope passed = ADMIN. The guard must not fire at all, so the call
      // proceeds past it and fails later on the un-stubbed prisma instead.
      const service = build();
      await expect(
        service.createOfficer(
          {
            name: 'Ada',
            email: 'a@viju.local',
            phone: '+2348012345678',
            password: 'Password123',
            role: 'ADMIN',
          },
          { id: 'admin-1' },
        ),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('RU-3 — editing a user', () => {
    const buildWith = (target: { role: string; region: string | null }) => {
      const service = Object.create(AdminService.prototype) as AdminService;
      (service as unknown as { prisma: unknown }).prisma = {
        staff: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'u-1', name: 'X', phone: 'p', ...target }),
        },
      };
      return service;
    };

    it('refuses to edit an ADMIN', async () => {
      const service = buildWith({ role: 'ADMIN', region: null });
      const code = await codeFrom(() =>
        service.updateOfficerProfile('u-1', { name: 'Renamed' }, 'LAGOS'),
      );
      expect(code).toBe('ROLE_NOT_ALLOWED');
    });

    it('refuses to edit a fellow REGIONAL_ADMIN', async () => {
      const service = buildWith({ role: 'REGIONAL_ADMIN', region: 'LAGOS' });
      const code = await codeFrom(() =>
        service.updateOfficerProfile('u-1', { name: 'Renamed' }, 'LAGOS'),
      );
      expect(code).toBe('ROLE_NOT_ALLOWED');
    });

    it('refuses to edit an officer in another region', async () => {
      const service = buildWith({ role: 'OFFICER', region: 'NORTH' });
      const code = await codeFrom(() =>
        service.updateOfficerProfile('u-1', { name: 'Renamed' }, 'LAGOS'),
      );
      expect(code).toBe('REGION_NOT_ALLOWED');
    });

    it('refuses to MOVE a user to another region', async () => {
      // A transfer out of their own scope, which the receiving region's admin
      // has not agreed to.
      const service = buildWith({ role: 'OFFICER', region: 'LAGOS' });
      const code = await codeFrom(() =>
        service.updateOfficerProfile('u-1', { region: 'NORTH' }, 'LAGOS'),
      );
      expect(code).toBe('REGION_NOT_ALLOWED');
    });

    it('allows editing an in-region officer', async () => {
      // Past both guards; the call then fails on the un-stubbed update, which
      // is enough to prove neither guard fired.
      const service = buildWith({ role: 'OFFICER', region: 'LAGOS' });
      await expect(
        service.updateOfficerProfile('u-1', { name: 'Renamed' }, 'LAGOS'),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('RB-2 — sending a regional broadcast', () => {
    const build = () =>
      Object.create(BroadcastService.prototype) as BroadcastService;

    it('refuses another region outright, rather than narrowing it', async () => {
      const code = await codeFrom(() =>
        build().sendRegional(
          'ra-1',
          { regions: ['NORTH'], message: 'hi' } as never,
          'LAGOS',
        ),
      );
      expect(code).toBe('REGION_NOT_ALLOWED');
    });

    it('refuses a multi-region send even when it includes their own', async () => {
      // Silently narrowing would tell an admin they reached three regions
      // when they reached one.
      const code = await codeFrom(() =>
        build().sendRegional(
          'ra-1',
          { regions: ['LAGOS', 'NORTH'], message: 'hi' } as never,
          'LAGOS',
        ),
      );
      expect(code).toBe('REGION_NOT_ALLOWED');
    });
  });

  describe('RB-3 — sending an individual broadcast', () => {
    const buildWith = (recipients: { id: string; region: string }[]) => {
      const service = Object.create(
        BroadcastService.prototype,
      ) as BroadcastService;
      (service as unknown as { prisma: unknown }).prisma = {
        customer: { findMany: jest.fn().mockResolvedValue(recipients) },
      };
      return service;
    };

    it('refuses the WHOLE call when any recipient is out of region', async () => {
      // Not a partial failed[] half: a broadcast is not idempotent, so a
      // retried half-send would double-message whoever did receive it.
      const service = buildWith([
        { id: 'c-1', region: 'LAGOS' },
        { id: 'c-2', region: 'NORTH' },
      ]);
      const code = await codeFrom(() =>
        service.sendIndividual(
          'ra-1',
          { customerIds: ['c-1', 'c-2'], message: 'hi' } as never,
          'LAGOS',
        ),
      );
      expect(code).toBe('REGION_NOT_ALLOWED');
    });

    it('sends nothing at all when it refuses', async () => {
      const service = buildWith([{ id: 'c-2', region: 'NORTH' }]);
      const sendOne = jest
        .spyOn(
          service as unknown as { sendToOneCustomer: () => Promise<unknown> },
          'sendToOneCustomer',
        )
        .mockResolvedValue({});

      await expect(
        service.sendIndividual(
          'ra-1',
          { customerId: 'c-2', message: 'hi' },
          'LAGOS',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(sendOne).not.toHaveBeenCalled();
    });
  });
});

/**
 * Spec 43 — BA-2, the one bulk route a regional admin does get.
 *
 * The limits are the point: their own region on BOTH sides. BA-1 is
 * deliberately absent, because bulk-region stays ADMIN-only — see
 * FRONTEND_GUIDE_CANCELLED_BY_AND_REGIONAL_BULK.md.
 */
describe('BA-2 — regional bulk customer reassignment', () => {
  const codeOf = (e: unknown): string | undefined => {
    const body = (e as { response?: Record<string, unknown> })?.response;
    return typeof body?.code === 'string' ? body.code : undefined;
  };

  const build = (opts: {
    officerRegion: string | null;
    customerRegions: Record<string, string>;
  }) => {
    const service = Object.create(AdminService.prototype) as AdminService;
    (service as unknown as { prisma: unknown }).prisma = {
      staff: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.officerRegion === null ? null : { region: opts.officerRegion },
          ),
      },
      customer: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            opts.customerRegions[where.id]
              ? { region: opts.customerRegions[where.id] }
              : null,
          ),
        ),
      },
    };
    const reassign = jest
      .spyOn(service, 'reassignOfficer')
      .mockResolvedValue({} as never);
    return { service, reassign };
  };

  it('refuses the WHOLE call when the receiving officer is out of region', async () => {
    // The officer is the same for every item, so a wrong one means the call is
    // wrong — one clear error rather than eighty identical failures.
    const { service, reassign } = build({
      officerRegion: 'NORTH',
      customerRegions: { 'c-1': 'LAGOS' },
    });

    try {
      await service.bulkReassignCustomers(['c-1'], 'off-1', 'LAGOS');
      throw new Error('expected a refusal');
    } catch (e) {
      expect(codeOf(e)).toBe('REGION_NOT_ALLOWED');
    }
    expect(reassign).not.toHaveBeenCalled();
  });

  it('moves the customers that are theirs and names the rest', async () => {
    // A partly-valid selection is exactly what the failed[] envelope is for.
    const { service } = build({
      officerRegion: 'LAGOS',
      customerRegions: { 'c-1': 'LAGOS', 'c-2': 'NORTH', 'c-3': 'LAGOS' },
    });

    const result = await service.bulkReassignCustomers(
      ['c-1', 'c-2', 'c-3'],
      'off-1',
      'LAGOS',
    );

    expect(result.succeeded).toEqual(['c-1', 'c-3']);
    expect(result.failed).toEqual([
      {
        customerId: 'c-2',
        code: 'REGION_NOT_ALLOWED',
        message: 'That distributor is not in your region.',
      },
    ]);
  });

  it('leaves an ADMIN unscoped', async () => {
    // No scope passed = ADMIN. Neither region check should run at all.
    const { service } = build({
      officerRegion: 'NORTH',
      customerRegions: { 'c-1': 'LAGOS' },
    });

    const result = await service.bulkReassignCustomers(['c-1'], 'off-1');

    expect(result.succeeded).toEqual(['c-1']);
    expect(result.failed).toEqual([]);
  });
});
