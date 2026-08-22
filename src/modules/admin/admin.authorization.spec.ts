import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Region } from '../../common/region/region.constants';
import { AdminController } from './admin.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StaffRole } from '@prisma/client';

/**
 * PRD 9 "Authorization": user management is ADMIN-only and enforced on the
 * server. A REGIONAL_ADMIN, OFFICER or LOADING_OFFICER must not be able to
 * create, deactivate or reactivate a managed user — and the caller's role is
 * read from the authenticated principal, never from the request body.
 *
 * These assertions are on the route metadata and the guard itself, so they
 * hold no matter what the service does, and they fail loudly if someone
 * widens a @Roles(...) list by accident.
 */
describe('Admin user-management authorization', () => {
  const reflector = new Reflector();

  /** The @Roles(...) that actually applies to a handler (handler wins). */
  const rolesFor = (method: keyof AdminController): string[] | undefined =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      AdminController.prototype[method] as () => unknown,
      AdminController,
    ]);

  it('guards the whole controller with JWT + roles', () => {
    const guards: unknown[] =
      Reflect.getMetadata(GUARDS_METADATA, AdminController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('defaults every admin route to ADMIN only', () => {
    expect(reflector.get<string[]>(ROLES_KEY, AdminController)).toEqual([
      'ADMIN',
    ]);
  });

  it.each<keyof AdminController>([
    'createOfficer',
    'updateOfficerStatus',
    'deactivateOfficer',
    'reassignAllCustomers',
  ])('keeps %s ADMIN-only', (method) => {
    expect(rolesFor(method)).toEqual(['ADMIN']);
  });

  it('lets a regional admin read officers but never manage them', () => {
    // RA-05 / RA-06 read access is a deliberate widening on the GET routes.
    expect(rolesFor('getOfficers')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
    expect(rolesFor('getOfficer')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
  });

  it('lets a regional admin read the customer list and one customer (RA-C1)', () => {
    expect(rolesFor('getAllCustomers')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
    expect(rolesFor('getCustomerDetail')).toEqual(['ADMIN', 'REGIONAL_ADMIN']);
  });

  it('keeps the customer CSV export ADMIN-only', () => {
    // Not part of RA-C1; the widening is deliberately confined to the two
    // read routes the regional admin portal actually calls.
    expect(rolesFor('exportCustomers')).toEqual(['ADMIN']);
  });

  describe('RolesGuard', () => {
    const guard = new RolesGuard(reflector);

    const contextFor = (
      method: keyof AdminController,
      role: string | undefined,
    ) =>
      ({
        getHandler: () => AdminController.prototype[method],
        getClass: () => AdminController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;

    it.each(['REGIONAL_ADMIN', 'OFFICER', 'LOADING_OFFICER', 'CUSTOMER'])(
      'refuses %s at POST /admin/officers',
      (role) => {
        expect(() =>
          guard.canActivate(contextFor('createOfficer', role)),
        ).toThrow(ForbiddenException);
      },
    );

    it.each(['REGIONAL_ADMIN', 'OFFICER', 'LOADING_OFFICER'])(
      'refuses %s at PATCH /admin/officers/:id',
      (role) => {
        expect(() =>
          guard.canActivate(contextFor('updateOfficerStatus', role)),
        ).toThrow(ForbiddenException);
      },
    );

    it('refuses a request with no role at all', () => {
      expect(() =>
        guard.canActivate(contextFor('createOfficer', undefined)),
      ).toThrow(ForbiddenException);
    });

    it('admits ADMIN', () => {
      expect(guard.canActivate(contextFor('createOfficer', 'ADMIN'))).toBe(
        true,
      );
      expect(
        guard.canActivate(contextFor('updateOfficerStatus', 'ADMIN')),
      ).toBe(true);
    });
  });

  describe('GET /admin/customers scoping (RA-C1 / B-1.1)', () => {
    const listed: Array<Record<string, unknown>> = [];
    const controller = new AdminController({
      getAllCustomers: (filter: Record<string, unknown>) => {
        listed.push(filter);
        return Promise.resolve({ data: [], meta: {} });
      },
    } as never);

    beforeEach(() => {
      listed.length = 0;
    });

    it("pins a regional admin to their own token's region", async () => {
      await controller.getAllCustomers(
        { role: 'REGIONAL_ADMIN', region: Region.LAGOS },
        { page: 1, pageSize: 20 },
      );

      expect(listed[0]).toMatchObject({ region: Region.LAGOS });
    });

    it('refuses a region sent by a regional admin with REGION_NOT_ALLOWED', async () => {
      // Region scoping is token-derived, so the parameter is refused rather
      // than silently ignored - a wrong value must not look like it worked.
      await expect(
        controller.getAllCustomers(
          { role: 'REGIONAL_ADMIN', region: Region.LAGOS },
          { region: Region.NORTH, page: 1, pageSize: 20 },
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'REGION_NOT_ALLOWED',
          message: 'Region is derived from your account',
        },
      });
      expect(listed).toHaveLength(0);
    });

    it('refuses even a regional admin asking for their OWN region explicitly', async () => {
      await expect(
        controller.getAllCustomers(
          { role: 'REGIONAL_ADMIN', region: Region.LAGOS },
          { region: Region.LAGOS, page: 1, pageSize: 20 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a regional admin whose record carries no region', async () => {
      // Returning `undefined` here would hand a misconfigured account every
      // region at once.
      await expect(
        controller.getAllCustomers(
          { role: 'REGIONAL_ADMIN', region: null },
          { page: 1, pageSize: 20 },
        ),
      ).rejects.toMatchObject({ response: { code: 'REGION_NOT_SET' } });
      expect(listed).toHaveLength(0);
    });

    it('leaves an ADMIN free to filter by any region, or none', async () => {
      await controller.getAllCustomers(
        { role: 'ADMIN', region: null },
        { region: Region.NORTH, page: 1, pageSize: 20 },
      );
      await controller.getAllCustomers(
        { role: 'ADMIN', region: null },
        { page: 1, pageSize: 20 },
      );

      expect(listed[0]).toMatchObject({ region: Region.NORTH });
      expect(listed[1]).toMatchObject({ region: undefined });
    });
  });

  describe('GET /admin/officers scoping', () => {
    const listed: Array<Record<string, unknown>> = [];
    const controller = new AdminController({
      getOfficers: (filter: Record<string, unknown>) => {
        listed.push(filter);
        return Promise.resolve({ data: [], meta: {} });
      },
    } as never);

    beforeEach(() => {
      listed.length = 0;
    });

    it('holds a regional admin to their own region and roles', async () => {
      await controller.getOfficers(
        { role: 'REGIONAL_ADMIN', region: 'LAGOS' },
        {
          // Everything the caller could try to widen their scope with.
          region: 'NORTH',
          role: StaffRole.ADMIN,
          managed: true,
          page: 1,
          pageSize: 20,
        } as never,
      );

      expect(listed[0]).toMatchObject({
        region: 'LAGOS',
        role: StaffRole.OFFICER,
        managed: false,
      });
    });

    it('accepts and IGNORES `region` from a regional admin - never a 403 (RA-O1)', async () => {
      // The explicit answer the officers screen needs: this route tolerates
      // the parameter and answers 200 with the caller's own region. It does
      // NOT behave like GET /admin/customers, which refuses it.
      await expect(
        controller.getOfficers({ role: 'REGIONAL_ADMIN', region: 'LAGOS' }, {
          region: 'LAGOS',
          page: 1,
          pageSize: 20,
        } as never),
      ).resolves.toBeDefined();

      expect(listed[0]).toMatchObject({ region: 'LAGOS' });
    });

    it('still lets a regional admin open the loading-officer picker (RA-06)', async () => {
      await controller.getOfficers(
        { role: 'REGIONAL_ADMIN', region: 'LAGOS' },
        { role: StaffRole.LOADING_OFFICER, page: 1, pageSize: 20 },
      );

      expect(listed[0]).toMatchObject({
        region: 'LAGOS',
        role: StaffRole.LOADING_OFFICER,
      });
    });

    it('lets an ADMIN list every managed role across every region', async () => {
      await controller.getOfficers(
        { role: 'ADMIN', region: null },
        {
          managed: true,
          page: 1,
          pageSize: 20,
        },
      );

      expect(listed[0]).toMatchObject({ region: undefined, managed: true });
    });
  });
});
