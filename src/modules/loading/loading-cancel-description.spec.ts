import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { LoadingService } from './loading.service';
import { assertCancellable, assertLoadingTransition } from './loading-status';

/**
 * L-1 (cancellation) and L-2 (the loading note) on the loading officer's own
 * routes. Spec 39.
 */
describe('Loading cancel + description (L-1, L-2)', () => {
  let service: LoadingService;

  const BASE = {
    id: 'lr-1',
    reference: 'WB-00231',
    status: 'ASSIGNED',
    assignedOfficerId: 'officer-1',
    loadingStartedAt: null,
    completedAt: null,
    waybillDocumentUrl: null,
    description: null,
    cancelledAt: null,
    cancelReason: null,
    truckPlateNumber: 'LAG-234-XY',
    driverName: 'John Dare',
    driverPhone: '+2348012345678',
    requestedLoadingDate: new Date('2026-08-26T09:00:00.000Z'),
    quantityCartons: 320,
    destination: 'Yaba Warehouse',
    region: 'LAGOS',
    createdAt: new Date('2026-08-25T16:41:02.000Z'),
    updatedAt: new Date('2026-08-26T11:20:31.000Z'),
    customer: { id: 'cust-1', name: 'ADLAK' },
    linkedPurchase: { erpId: 'ORD-1' },
  };

  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    loadingRequest: { findUnique: jest.fn(), update: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoadingService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = module.get(LoadingService);
    prisma.loadingRequest.findUnique.mockResolvedValue(BASE);
  });

  afterEach(() => jest.clearAllMocks());

  describe('L-1 / LC-1 — the cancellation window', () => {
    it('allows cancelling from PENDING and ASSIGNED', () => {
      expect(() => assertCancellable('PENDING_ASSIGNMENT')).not.toThrow();
      expect(() => assertCancellable('ASSIGNED')).not.toThrow();
    });

    it('LC-1 — refuses to cancel a load that is already being loaded', () => {
      // Narrowed from L-1, which allowed this. Stock integrity, not tidiness:
      // cancelling mid-load leaves goods physically moved with no waybill
      // accounting for them, and the portal cannot reconcile that.
      expect(() => assertCancellable('LOADING_IN_PROGRESS')).toThrow(
        ConflictException,
      );
    });

    it('refuses to cancel a COMPLETED load', () => {
      // The button is hidden for those rows, but the API is the control.
      expect(() => assertCancellable('COMPLETED')).toThrow(ConflictException);
    });

    it('explains WHY an in-progress load cannot be cancelled', () => {
      // The portal renders `message` verbatim, so it has to say something an
      // operator can act on rather than restate the enum values.
      try {
        assertCancellable('LOADING_IN_PROGRESS');
        throw new Error('expected a refusal');
      } catch (e) {
        const body = (e as { response?: Record<string, unknown> }).response;
        expect(body?.message).toBe(
          'This load is already being loaded and cannot be cancelled.',
        );
        expect(body?.code).toBe('INVALID_STATUS_TRANSITION');
        expect(body?.statusCode).toBe(409);
      }
    });

    it('still allows the forward moves LC-1 does not touch', () => {
      // ASSIGNED -> IN_PROGRESS -> COMPLETED must be unaffected.
      expect(() =>
        assertLoadingTransition('ASSIGNED', 'LOADING_IN_PROGRESS'),
      ).not.toThrow();
      expect(() =>
        assertLoadingTransition('LOADING_IN_PROGRESS', 'COMPLETED'),
      ).not.toThrow();
      expect(() =>
        assertLoadingTransition('ASSIGNED', 'COMPLETED'),
      ).not.toThrow();
    });
  });

  describe('L-1 — the loading officer cancels their own load', () => {
    it('stamps cancelledAt, the reason and who did it', async () => {
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        status: 'CANCELLED',
        cancelledAt: new Date('2026-08-26T14:02:11.000Z'),
        cancelReason: 'distributor rescheduled',
      });

      const result = await service.updateStatus('officer-1', 'lr-1', {
        status: 'CANCELLED',
        reason: 'distributor rescheduled',
      } as never);

      const data = prisma.loadingRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelledAt).toBeInstanceOf(Date);
      expect(data.cancelledById).toBe('officer-1');
      expect(data.cancelReason).toBe('distributor rescheduled');
      expect(result.cancelReason).toBe('distributor rescheduled');
    });

    it('records no reason at all rather than a blank one', async () => {
      // "No reason recorded" and "the reason was empty" must stay
      // distinguishable, so a whitespace-only reason is not stored.
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        status: 'CANCELLED',
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'CANCELLED',
        reason: '   ',
      } as never);

      expect(
        prisma.loadingRequest.update.mock.calls[0][0].data,
      ).not.toHaveProperty('cancelReason');
    });

    it('tells the distributor the load was cancelled', async () => {
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        status: 'CANCELLED',
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'CANCELLED',
      } as never);

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.recipientType).toBe('CUSTOMER');
      expect(payload.body).toBe('Your loading status is now: Cancelled');
    });

    it('leaves cancellation stamps alone on an ordinary status move', async () => {
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        status: 'LOADING_IN_PROGRESS',
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'IN_PROGRESS',
      } as never);

      const data = prisma.loadingRequest.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('cancelledAt');
      expect(data).not.toHaveProperty('cancelledById');
    });
  });

  describe('L-2 — the loading note', () => {
    it('saves the note and returns the full detail body', async () => {
      const note =
        'customer loading 800 cartons on 26/08/2026, remaining a balance of 200 cartons';
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        description: note,
      });

      const result = await service.updateDescription('officer-1', 'lr-1', {
        description: note,
      });

      // TS-1 — the note and its own timestamp are written together.
      const data = prisma.loadingRequest.update.mock.calls[0][0].data;
      expect(data.description).toBe(note);
      expect(data.descriptionUpdatedAt).toBeInstanceOf(Date);
      // The whole assignment comes back, so the screen re-renders from one body.
      expect(result.description).toBe(note);
      expect(result.waybill).toBe('WB-00231');
      expect(result.status).toBe('ASSIGNED');
    });

    it('clears the note to null on an empty save', async () => {
      // Clearing a wrong note is better than leaving it in place, so "" is a
      // valid save rather than a validation error.
      prisma.loadingRequest.update.mockResolvedValue({
        ...BASE,
        description: null,
      });

      await service.updateDescription('officer-1', 'lr-1', {
        description: '',
      });

      // TS-1 — clearing the note clears its timestamp alongside it, rather
      // than leaving a stamp on a note that no longer exists.
      expect(prisma.loadingRequest.update.mock.calls[0][0].data).toEqual({
        description: null,
        descriptionUpdatedAt: null,
      });
    });

    it('never moves the status when the note is saved', async () => {
      prisma.loadingRequest.update.mockResolvedValue({ ...BASE });

      await service.updateDescription('officer-1', 'lr-1', {
        description: 'note',
      });

      expect(
        prisma.loadingRequest.update.mock.calls[0][0].data,
      ).not.toHaveProperty('status');
    });

    it('refuses an officer the load is not assigned to', async () => {
      prisma.loadingRequest.findUnique.mockResolvedValue({
        ...BASE,
        assignedOfficerId: 'someone-else',
      });

      await expect(
        service.updateDescription('officer-1', 'lr-1', { description: 'note' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.loadingRequest.update).not.toHaveBeenCalled();
    });
  });
});
