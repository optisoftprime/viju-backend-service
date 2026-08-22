import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * F-1 - a product flyer carries its own copy.
 *
 * The artwork alone cannot hold the offer's terms, dates or small print as
 * text a distributor can read, copy or have read aloud. `description` is
 * nullable free text with three distinct PATCH behaviours the form relies on.
 */
describe('Product flyer description (F-1)', () => {
  const build = (existing: Record<string, unknown> | null = null) => {
    const prisma = {
      productFlyer: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(existing),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
        create: jest.fn((args: Record<string, unknown>) =>
          Promise.resolve(args.data),
        ),
        update: jest.fn((args: Record<string, unknown>) =>
          Promise.resolve(args.data),
        ),
      },
    };
    const service = new AdminService(
      prisma as never,
      { notify: jest.fn() } as never,
      { send: jest.fn() },
      {} as never,
      {} as never,
      { getRunningBalances: jest.fn().mockResolvedValue(new Map()) } as never,
    );
    return { prisma, service };
  };

  describe('create', () => {
    it('stores the copy it was given, trimmed', async () => {
      const { service } = build();

      const created = await service.createProductFlyer(
        {
          name: 'December Bulk Offer',
          imageUrl: 'https://cdn/flyer.jpg',
          description: '  Buy 50 cartons and get 5 free.  ',
        },
        'admin-1',
      );

      expect(created).toMatchObject({
        description: 'Buy 50 cartons and get 5 free.',
      });
    });

    it('stores null when the property is omitted', async () => {
      const { service } = build();

      const created = await service.createProductFlyer(
        { name: 'December Bulk Offer', imageUrl: 'https://cdn/flyer.jpg' },
        'admin-1',
      );

      expect(created).toMatchObject({ description: null });
    });

    it('stores null rather than an empty string for blank copy', async () => {
      // "Never written" and "deliberately cleared" both read back as null, and
      // neither is an empty string the card would render as a blank line.
      const { service } = build();

      const created = await service.createProductFlyer(
        {
          name: 'December Bulk Offer',
          imageUrl: 'https://cdn/flyer.jpg',
          description: '   ',
        },
        'admin-1',
      );

      expect(created).toMatchObject({ description: null });
    });
  });

  describe('update - the three cases the form relies on', () => {
    const existing = {
      id: 'f-1',
      name: 'December Bulk Offer',
      imageUrl: 'https://cdn/flyer.jpg',
      description: 'Buy 50 cartons and get 5 free.',
      isActive: true,
    };

    it('leaves the copy UNCHANGED when the property is omitted', async () => {
      const { service } = build(existing);

      const updated = await service.updateProductFlyer('f-1', {
        name: 'Renamed',
      });

      expect(updated).toMatchObject({
        name: 'Renamed',
        description: 'Buy 50 cartons and get 5 free.',
      });
    });

    it('CLEARS the copy when sent an empty string', async () => {
      // `?? existing` cannot express this - '' is not nullish - which is why
      // the field is compared against undefined explicitly.
      const { service } = build(existing);

      const updated = await service.updateProductFlyer('f-1', {
        description: '',
      });

      expect(updated).toMatchObject({ description: null });
    });

    it('REPLACES the copy when sent text', async () => {
      const { service } = build(existing);

      const updated = await service.updateProductFlyer('f-1', {
        description: '  New terms apply.  ',
      });

      expect(updated).toMatchObject({ description: 'New terms apply.' });
    });

    it('clears copy sent as whitespace only', async () => {
      const { service } = build(existing);

      const updated = await service.updateProductFlyer('f-1', {
        description: '   ',
      });

      expect(updated).toMatchObject({ description: null });
    });

    it('reads back null on a flyer that predates the column', async () => {
      const { service } = build({ ...existing, description: null });

      const updated = await service.updateProductFlyer('f-1', {
        name: 'Renamed',
      });

      expect(updated).toMatchObject({ description: null });
    });

    it('still 404s an unknown flyer', async () => {
      const { service } = build(null);

      await expect(
        service.updateProductFlyer('nope', { description: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('leaves the other columns behaving exactly as before', async () => {
      const { service } = build(existing);

      const updated = await service.updateProductFlyer('f-1', {});

      expect(updated).toMatchObject({
        name: 'December Bulk Offer',
        imageUrl: 'https://cdn/flyer.jpg',
        isActive: true,
      });
    });
  });
});
