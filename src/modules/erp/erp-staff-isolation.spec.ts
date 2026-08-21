import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  MANAGED_STAFF_ROLES,
  isManagedStaffRole,
  normalizeManagedRole,
  requiresRegion,
} from '../../common/roles/managed-roles';

/**
 * PRD "ERP Synchronization Changes": the ERP must not create, delete,
 * deactivate, reactivate or re-role an internally managed user. The rest of
 * the ERP pipeline (customers, balances, purchases, payments, stock, order
 * status, default-officer assignment) has to keep working.
 *
 * The auth-boundary rules are asserted behaviourally in auth.service.spec.ts.
 * What that cannot catch is a NEW ERP code path quietly reintroducing a Staff
 * write, so this suite is a structural guard over the ERP surface.
 */
const ERP_SOURCE_ROOTS = [
  join(__dirname), // src/modules/erp — the ERP webhook surface
  join(__dirname, '..', '..', 'infrastructure', 'erp-raw'), // ERP landing feed
];

function collectSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectSources(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('ERP synchronisation cannot manage internal users', () => {
  const sources = ERP_SOURCE_ROOTS.flatMap(collectSources);

  it('finds the ERP sources it is meant to guard', () => {
    // Guards the guard: a moved directory must fail loudly rather than make
    // this suite vacuously pass.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((f) => f.endsWith('erp.service.ts'))).toBe(true);
    expect(sources.some((f) => f.endsWith('erp-raw.service.ts'))).toBe(true);
  });

  it.each([
    'create',
    'createMany',
    'upsert',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
  ])('never calls staff.%s', (method) => {
    const offenders = sources.filter((file) =>
      new RegExp(`staff\\.${method}\\b`).test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('touches Staff through read operations only', () => {
    // Catches a write via a Prisma method the list above has not thought of:
    // whatever `staff.<x>` the ERP calls, `<x>` must be a read.
    const READS = [
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
      'fields',
    ];
    const offenders: string[] = [];
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      for (const [, method] of source.matchAll(/\bstaff\.([A-Za-z]+)/g)) {
        if (!READS.includes(method)) offenders.push(`${file}: staff.${method}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves the other ERP sync paths in place', () => {
    // Removing staff provisioning must not have disabled the ERP pipeline.
    const erpService = readFileSync(join(__dirname, 'erp.service.ts'), 'utf8');
    for (const method of [
      'syncBalance',
      'syncStock',
      'syncPurchase',
      'syncPayment',
    ]) {
      expect(erpService).toContain(`async ${method}(`);
    }

    const controller = readFileSync(
      join(__dirname, 'erp.controller.ts'),
      'utf8',
    );
    for (const route of [
      'sync/balance',
      'sync/stock',
      'sync/purchases',
      'sync/payments',
      'sync/order-status',
      'sync/default-officer',
    ]) {
      expect(controller).toContain(`'${route}'`);
    }
  });
});

describe('managed role set', () => {
  it('covers exactly the four roles the PRD moves in-house', () => {
    expect([...MANAGED_STAFF_ROLES]).toEqual([
      'ADMIN',
      'REGIONAL_ADMIN',
      'OFFICER',
      'LOADING_OFFICER',
    ]);
  });

  it('leaves WAREHOUSE_OFFICER to the ERP', () => {
    expect(isManagedStaffRole('WAREHOUSE_OFFICER')).toBe(false);
  });

  it.each([null, undefined, '', 'admin', 'SUPER_ADMIN'])(
    'treats %p as unmanaged',
    (value) => {
      expect(isManagedStaffRole(value)).toBe(false);
      expect(normalizeManagedRole(value)).toBeNull();
    },
  );

  it('maps the PRD ACCOUNT_OFFICER spelling onto OFFICER', () => {
    expect(normalizeManagedRole('ACCOUNT_OFFICER')).toBe('OFFICER');
  });

  it('requires a region for every role but ADMIN', () => {
    expect(requiresRegion('ADMIN')).toBe(false);
    expect(requiresRegion('REGIONAL_ADMIN')).toBe(true);
    expect(requiresRegion('OFFICER')).toBe(true);
    expect(requiresRegion('LOADING_OFFICER')).toBe(true);
  });
});
