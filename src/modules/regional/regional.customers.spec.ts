import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RegionalController } from './regional.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Region } from '../../common/region/region.constants';

/**
 * RA-C2 — GET /regional/customers, the regional admin Customers page.
 *
 * The region comes from the caller's own record, never from the query string,
 * and the rows are produced by the SAME AdminService.getAllCustomers the admin
 * list uses, so the two cannot drift apart in shape, sorting or ERP columns.
 */
describe('GET /regional/customers (RA-C2)', () => {
  const reflector = new Reflector();

  const calls: Array<Record<string, unknown>> = [];
  const controller = new RegionalController(
    {} as never,
    {
      getAllCustomers: (filter: Record<string, unknown>) => {
        calls.push(filter);
        return Promise.resolve({ data: [], meta: { total: 0 } });
      },
    } as never,
  );

  beforeEach(() => {
    calls.length = 0;
  });

  /** The @Roles(...) that actually applies to a handler (handler wins). */
  const rolesFor = (method: keyof RegionalController): string[] | undefined =>
    reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      RegionalController.prototype[method] as () => unknown,
      RegionalController,
    ]);

  it('is open to REGIONAL_ADMIN and ADMIN only', () => {
    expect(rolesFor('getRegionalCustomers')).toEqual([
      'REGIONAL_ADMIN',
      'ADMIN',
    ]);
  });

  it("pins a regional admin to their own record's region", async () => {
    await controller.getRegionalCustomers(
      { id: 'ra-1', role: 'REGIONAL_ADMIN', region: Region.LAGOS },
      { page: 1, pageSize: 20 },
    );

    expect(calls[0]).toMatchObject({ region: Region.LAGOS });
  });

  it('tolerates a regional admin repeating their OWN region', async () => {
    // Deliberately more forgiving than GET /admin/customers, which refuses the
    // parameter outright: this route exists to be the easy one to call.
    await controller.getRegionalCustomers(
      { id: 'ra-1', role: 'REGIONAL_ADMIN', region: Region.LAGOS },
      { region: Region.LAGOS, page: 1, pageSize: 20 },
    );

    expect(calls[0]).toMatchObject({ region: Region.LAGOS });
  });

  it('refuses a regional admin reaching into another region', async () => {
    await expect(
      controller.getRegionalCustomers(
        { id: 'ra-1', role: 'REGIONAL_ADMIN', region: Region.LAGOS },
        { region: Region.NORTH, page: 1, pageSize: 20 },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(calls).toHaveLength(0);
  });

  it('refuses a regional admin whose record has no region', async () => {
    await expect(
      controller.getRegionalCustomers(
        { id: 'ra-1', role: 'REGIONAL_ADMIN', region: null },
        { page: 1, pageSize: 20 },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires an ADMIN to name the region, since they have none', async () => {
    await expect(
      controller.getRegionalCustomers(
        { id: 'a-1', role: 'ADMIN', region: null },
        { page: 1, pageSize: 20 },
      ),
    ).rejects.toThrow(ForbiddenException);

    await controller.getRegionalCustomers(
      { id: 'a-1', role: 'ADMIN', region: null },
      { region: Region.NORTH, page: 1, pageSize: 20 },
    );
    expect(calls[0]).toMatchObject({ region: Region.NORTH });
  });

  it('passes every other filter through untouched', async () => {
    await controller.getRegionalCustomers(
      { id: 'ra-1', role: 'REGIONAL_ADMIN', region: Region.LAGOS },
      {
        search: 'adlak',
        hasOfficer: false,
        includeUnprojected: true,
        sortBy: 'name',
        sortOrder: 'asc',
        page: 2,
        pageSize: 50,
      },
    );

    expect(calls[0]).toMatchObject({
      region: Region.LAGOS,
      search: 'adlak',
      hasOfficer: false,
      includeUnprojected: true,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });
});
