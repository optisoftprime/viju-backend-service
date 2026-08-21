import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
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
