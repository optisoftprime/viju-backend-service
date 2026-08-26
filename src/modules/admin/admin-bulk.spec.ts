import { ConflictException, BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * O-2 / C-2 — the bulk actions from spec 39.
 *
 * The contract that matters is PARTIAL SUCCESS: moving nine officers and
 * failing the tenth must leave nine moved. These drive the real methods with
 * the per-item operation stubbed, so the batching semantics are pinned
 * independently of what a single move does.
 */
describe('Admin bulk actions (O-2, C-2)', () => {
  // Only the two per-item methods are stubbed; runBulk itself is the real one.
  const build = () => {
    const service = Object.create(AdminService.prototype) as AdminService;
    return service;
  };

  const codedError = (code: string, message = code) =>
    new BadRequestException({ message, code, statusCode: 400 });

  describe('O-2 — bulk officer region', () => {
    it('moves what it can and names what it cannot', async () => {
      const service = build();
      jest
        .spyOn(service, 'updateOfficerProfile')
        .mockImplementation((id: string) =>
          id === 'admin-1'
            ? Promise.reject(
                codedError(
                  'REGION_NOT_ALLOWED',
                  'An ADMIN is organisation-wide and cannot be scoped to a region.',
                ),
              )
            : Promise.resolve({ id, changed: true }),
        );

      const result = await service.bulkUpdateOfficerRegion(
        ['off-1', 'admin-1', 'off-2'],
        'OTHERS',
      );

      // The two valid officers still moved — the batch is not all-or-nothing.
      expect(result.succeeded).toEqual(['off-1', 'off-2']);
      expect(result.failed).toEqual([
        {
          officerId: 'admin-1',
          code: 'REGION_NOT_ALLOWED',
          message:
            'An ADMIN is organisation-wide and cannot be scoped to a region.',
        },
      ]);
    });

    it('collapses duplicate ids so one officer is not counted twice', async () => {
      const service = build();
      const move = jest
        .spyOn(service, 'updateOfficerProfile')
        .mockResolvedValue({ changed: true });

      const result = await service.bulkUpdateOfficerRegion(
        ['off-1', 'off-1', 'off-2'],
        'LAGOS',
      );

      expect(move).toHaveBeenCalledTimes(2);
      expect(result.succeeded).toEqual(['off-1', 'off-2']);
    });

    it('reports UNKNOWN for a failure that carried no code', async () => {
      const service = build();
      jest
        .spyOn(service, 'updateOfficerProfile')
        .mockRejectedValue(new Error('database is down'));

      const result = await service.bulkUpdateOfficerRegion(['off-1'], 'LAGOS');

      expect(result.succeeded).toEqual([]);
      expect(result.failed[0]).toEqual({
        officerId: 'off-1',
        code: 'UNKNOWN',
        message: 'database is down',
      });
    });
  });

  describe('C-2 — bulk customer reassignment', () => {
    it('counts ALREADY_ASSIGNED as a success', async () => {
      // The customer ends up holding exactly the officer that was asked for,
      // which is the point of the call — so re-running a half-finished batch
      // must not look broken.
      const service = build();
      jest.spyOn(service, 'reassignOfficer').mockImplementation((id: string) =>
        id === 'cust-2'
          ? Promise.reject(
              new ConflictException({
                message: 'Ada is already assigned to this customer',
                code: 'ALREADY_ASSIGNED',
                statusCode: 409,
              }),
            )
          : (Promise.resolve({ id }) as never),
      );

      const result = await service.bulkReassignCustomers(
        ['cust-1', 'cust-2'],
        'officer-1',
      );

      expect(result.succeeded).toEqual(['cust-1', 'cust-2']);
      expect(result.failed).toEqual([]);
    });

    it('still reports a genuine failure, keyed by customerId', async () => {
      const service = build();
      jest
        .spyOn(service, 'reassignOfficer')
        .mockImplementation((id: string) =>
          id === 'cust-2'
            ? Promise.reject(
                codedError(
                  'OFFICER_NOT_FOUND',
                  'Officer not found or inactive',
                ),
              )
            : (Promise.resolve({ id }) as never),
        );

      const result = await service.bulkReassignCustomers(
        ['cust-1', 'cust-2'],
        'officer-1',
      );

      expect(result.succeeded).toEqual(['cust-1']);
      expect(result.failed).toEqual([
        {
          customerId: 'cust-2',
          code: 'OFFICER_NOT_FOUND',
          message: 'Officer not found or inactive',
        },
      ]);
    });

    it('processes items in sequence, not in parallel', async () => {
      // Each move can write a CustomerOfficer row and send a notification; a
      // burst of eighty concurrent writes is not what this route is for.
      const service = build();
      let inFlight = 0;
      let maxInFlight = 0;
      jest.spyOn(service, 'reassignOfficer').mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return {} as never;
      });

      await service.bulkReassignCustomers(
        ['c-1', 'c-2', 'c-3', 'c-4'],
        'officer-1',
      );

      expect(maxInFlight).toBe(1);
    });
  });
});
