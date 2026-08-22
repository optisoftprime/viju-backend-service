import { NotificationsService } from './notifications.service';
import { WaybillService } from '../waybill/waybill.service';
import { RegionalService } from '../regional/regional.service';

/**
 * N-2, N-3, N-4 - a notification row exists only for the person it concerns.
 *
 * The audience is decided at WRITE time: at read time a row written for the
 * wrong person is indistinguishable from one written correctly, so the fan-out
 * is the only place this can be got right.
 */
describe('Notification audience (N-2, N-3, N-4)', () => {
  describe('N-2 - a new loading request', () => {
    const build = (staff: unknown[]) => {
      const prisma = {
        termsAcceptance: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ acceptedAt: new Date('2026-08-22') }),
        },
        customer: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'c-1', region: 'LAGOS', name: 'ADLAK' }),
        },
        purchase: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }) },
        loadingRequest: {
          create: jest
            .fn()
            .mockResolvedValue({ id: 'lr-1', reference: 'WB-00231' }),
        },
        staff: { findMany: jest.fn().mockResolvedValue(staff) },
      };
      const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
      return {
        prisma,
        notifications,
        service: new WaybillService(prisma as never, notifications as never),
      };
    };

    const dto = {
      linkedPurchaseId: 'p-1',
      truckPlateNumber: 'LAG-123',
      driverName: 'Musa',
      driverPhone: '+2348000000000',
      requestedLoadingDate: '2026-08-25T00:00:00.000Z',
      quantityCartons: 100,
      destination: 'Ikeja',
    };

    it('asks only for ACTIVE regional admins of the request region', async () => {
      const { service, prisma } = build([]);

      await service.submitLoadingRequest('c-1', dto);

      expect(prisma.staff.findMany).toHaveBeenCalledWith({
        where: { role: 'REGIONAL_ADMIN', region: 'LAGOS', isActive: true },
        select: { id: true },
      });
    });

    it('writes one row per regional admin, and none for anyone else', async () => {
      const { service, notifications } = build([
        { id: 'ra-1' },
        { id: 'ra-2' },
      ]);

      await service.submitLoadingRequest('c-1', dto);

      expect(notifications.notify).toHaveBeenCalledTimes(2);
      const recipients = notifications.notify.mock.calls.map(
        (c) => c[0].recipientId,
      );
      expect(recipients.sort()).toEqual(['ra-1', 'ra-2']);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'STAFF',
          type: 'WAYBILL_SUBMITTED',
          subjectCustomerId: 'c-1',
          body: 'ADLAK raised a loading request in LAGOS',
        }),
      );
    });

    it('writes nothing when the region has no regional admin', async () => {
      const { service, notifications } = build([]);

      await service.submitLoadingRequest('c-1', dto);

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('N-3 - assigning a loading request', () => {
    const build = () => {
      const prisma = {
        loadingRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'lr-1',
            status: 'PENDING_ASSIGNMENT',
            requestedLoadingDate: new Date('2026-08-25T00:00:00.000Z'),
            customer: { id: 'c-1', name: 'ADLAK' },
          }),
          update: jest.fn().mockResolvedValue({
            id: 'lr-1',
            reference: 'WB-00231',
            status: 'ASSIGNED',
            requestedLoadingDate: new Date('2026-08-25T00:00:00.000Z'),
            createdAt: new Date('2026-08-22T00:00:00.000Z'),
            customer: { id: 'c-1', name: 'ADLAK' },
            assignedOfficer: { id: 'lo-1', name: 'Musa Bello' },
            linkedPurchase: null,
          }),
        },
        staff: {
          findFirst: jest.fn().mockResolvedValue({ id: 'lo-1' }),
        },
      };
      const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
      return {
        prisma,
        notifications,
        service: new RegionalService(prisma as never, notifications as never),
      };
    };

    it('writes one row for the ASSIGNED loading officer, naming the load', async () => {
      const { service, notifications } = build();

      await service.assignLoadingRequest('LAGOS', 'ra-1', 'lr-1', {
        loadingOfficerId: 'lo-1',
      });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientType: 'STAFF',
          recipientId: 'lo-1',
          subjectCustomerId: 'c-1',
          type: 'WAYBILL_ASSIGNED',
          body: 'ADLAK — WB-00231 is ready for loading',
        }),
      );
    });

    it('writes to nobody else on staff - only the distributor as well', async () => {
      const { service, notifications } = build();

      await service.assignLoadingRequest('LAGOS', 'ra-1', 'lr-1', {
        loadingOfficerId: 'lo-1',
      });

      const staffRows = notifications.notify.mock.calls
        .map((c) => c[0])
        .filter((p) => p.recipientType === 'STAFF');
      expect(staffRows).toHaveLength(1);
      expect(staffRows[0].recipientId).toBe('lo-1');

      // The distributor's own feed still gets its row; that is their bell,
      // not a staff one.
      const customerRows = notifications.notify.mock.calls
        .map((c) => c[0])
        .filter((p) => p.recipientType === 'CUSTOMER');
      expect(customerRows).toHaveLength(1);
      expect(customerRows[0].recipientId).toBe('c-1');
    });
  });

  describe('N-1 - a customer never reads a staff row about them', () => {
    const build = () => {
      const prisma = {
        notification: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue({ id: 'n-1' }),
          update: jest.fn().mockResolvedValue({ id: 'n-1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return { prisma, service: new NotificationsService(prisma as never) };
    };

    it('requires staffId null when listing a customer feed', async () => {
      // A staff row now carries the distributor it concerns in `customerId`.
      // Without this clause those rows would surface in the customer's bell.
      const { service, prisma } = build();

      await service.listForCustomer('c-1', { page: 1, pageSize: 20 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c-1', staffId: null },
        }),
      );
    });

    it('scopes a staff feed by staffId alone', async () => {
      const { service, prisma } = build();

      await service.listForStaff('o-1', { page: 1, pageSize: 20 });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { staffId: 'o-1' } }),
      );
    });

    it('stops a customer marking a staff row about them as read', async () => {
      const { service, prisma } = build();

      await service.markRead('CUSTOMER', 'c-1', 'n-1');

      expect(prisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'n-1', customerId: 'c-1', staffId: null },
      });
    });

    it('applies the same rule to mark-all-read', async () => {
      const { service, prisma } = build();

      await service.markAllRead('CUSTOMER', 'c-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerId: 'c-1', staffId: null, isRead: false },
        }),
      );
    });
  });
});
