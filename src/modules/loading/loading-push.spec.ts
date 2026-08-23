import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationService } from '../../infrastructure/notification/notification.service';
import { LoadingService } from './loading.service';
import { toStatusLabel } from './loading-status';

/**
 * P-1, P-2 — what the distributor is told when their load moves.
 *
 * The wording is pinned because it is prose a distributor reads on a lock
 * screen: an enum leaking into it (LOADING_IN_PROGRESS) or a stale hard-coded
 * status is a visible defect, not a cosmetic one.
 */
describe('Loading push notifications (P-1, P-2)', () => {
  let service: LoadingService;

  const REQUEST = {
    id: 'lr-1',
    status: 'ASSIGNED',
    assignedOfficerId: 'officer-1',
    loadingStartedAt: null,
    completedAt: null,
    reference: 'WB-00231',
    waybillDocumentUrl: null,
    customer: { id: 'cust-1', name: 'ADLAK' },
    linkedPurchase: { erpId: 'ORD-1' },
    createdAt: new Date('2026-08-23T08:00:00.000Z'),
    region: 'LAGOS',
  };

  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };

  const prisma = {
    loadingRequest: {
      findUnique: jest.fn().mockResolvedValue(REQUEST),
      update: jest.fn(),
    },
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
    prisma.loadingRequest.findUnique.mockResolvedValue(REQUEST);
  });

  afterEach(() => jest.clearAllMocks());

  describe('P-1 — status change', () => {
    it('sends the human-readable status, never the enum', async () => {
      prisma.loadingRequest.update.mockResolvedValue({
        ...REQUEST,
        status: 'LOADING_IN_PROGRESS',
        updatedAt: new Date(),
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'IN_PROGRESS',
      } as never);

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.content).toBeUndefined(); // default "<title>: <body>"
      expect(payload.title).toBe('Loading update');
      expect(payload.body).toBe(
        'Your loading status is now: Loading in Progress',
      );
      expect(payload.type).toBe('WAYBILL_STATUS_CHANGED');
      expect(payload.recipientType).toBe('CUSTOMER');
      expect(payload.recipientId).toBe('cust-1');
      // No enum spelling in either vocabulary.
      expect(payload.body).not.toContain('LOADING_IN_PROGRESS');
      expect(payload.body).not.toContain('IN_PROGRESS');
    });

    it('derives the wording from the status rather than hard-coding it', async () => {
      // The body used to be the literal string "Your loading status is now:
      // Loading in Progress" for EVERY non-completed move. Today's transition
      // table (ASSIGNED -> IN_PROGRESS | COMPLETED, IN_PROGRESS -> COMPLETED)
      // makes IN_PROGRESS the only reachable non-terminal target, so that
      // hard-coding happened to read correctly — it was a latent defect, not a
      // live one. Deriving it means widening the transition table cannot
      // silently start lying to distributors.
      prisma.loadingRequest.update.mockResolvedValue({
        ...REQUEST,
        status: 'LOADING_IN_PROGRESS',
        updatedAt: new Date(),
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'IN_PROGRESS',
      } as never);

      expect(notifications.notify.mock.calls[0][0].body).toBe(
        `Your loading status is now: ${toStatusLabel('LOADING_IN_PROGRESS')}`,
      );
    });
  });

  describe('P-2 — completion', () => {
    it('announces completion and carries the reference and document link', async () => {
      prisma.loadingRequest.findUnique.mockResolvedValue({
        ...REQUEST,
        status: 'LOADING_IN_PROGRESS',
      });
      prisma.loadingRequest.update.mockResolvedValue({
        ...REQUEST,
        status: 'COMPLETED',
        reference: 'WB-00231',
        waybillDocumentUrl: 'https://cdn.example/waybill.pdf',
        truckPlateNumber: 'LAG-234-XY',
        driverName: 'Jimoh Ibrahim',
        quantityCartons: 320,
        updatedAt: new Date(),
      });

      await service.recordWaybill('officer-1', 'lr-1', {
        truckPlateNumber: 'LAG-234-XY',
        driverName: 'Jimoh Ibrahim',
        quantityCartons: 320,
        attachmentUrl: 'https://cdn.example/waybill.pdf',
      });

      const payload = notifications.notify.mock.calls[0][0];
      expect(payload.title).toBe('Loading complete');
      expect(payload.body).toBe(
        'Your loading is complete. View your waybill in the app.',
      );
      expect(payload.type).toBe('WAYBILL_COMPLETED');
      // The deep-link payload the app opens the document with.
      expect(payload.data).toEqual({
        waybillId: 'lr-1',
        reference: 'WB-00231',
        attachmentUrl: 'https://cdn.example/waybill.pdf',
      });
    });

    it('omits attachmentUrl rather than sending the string "null"', async () => {
      // FCM data values are strings; a missing document must not arrive as
      // the four characters "null" for the app to try to open.
      prisma.loadingRequest.findUnique.mockResolvedValue({
        ...REQUEST,
        status: 'LOADING_IN_PROGRESS',
      });
      prisma.loadingRequest.update.mockResolvedValue({
        ...REQUEST,
        status: 'COMPLETED',
        waybillDocumentUrl: null,
        updatedAt: new Date(),
      });

      await service.updateStatus('officer-1', 'lr-1', {
        status: 'COMPLETED',
      } as never);

      const { data } = notifications.notify.mock.calls[0][0];
      expect(data.attachmentUrl).toBeUndefined();
      expect(data.reference).toBe('WB-00231');
    });
  });

  describe('status labels', () => {
    it('gives every status customer-safe wording', () => {
      expect(toStatusLabel('PENDING_ASSIGNMENT')).toBe('Pending Assignment');
      expect(toStatusLabel('ASSIGNED')).toBe('Assigned');
      expect(toStatusLabel('LOADING_IN_PROGRESS')).toBe('Loading in Progress');
      expect(toStatusLabel('COMPLETED')).toBe('Completed');
      expect(toStatusLabel('CANCELLED')).toBe('Cancelled');
    });
  });
});
