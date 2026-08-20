import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RA-03: the signed-in principal, including the region that scopes every
   * region-filtered endpoint. Re-read from the database rather than echoed
   * from the token so a reassignment or deactivation shows up immediately.
   */
  async getMe(user: { id: string; role: string }) {
    if (user.role === 'CUSTOMER') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          region: true,
          profilePhotoUrl: true,
        },
      });
      if (!customer) throw new NotFoundException('User not found');
      return {
        ...customer,
        role: 'CUSTOMER' as const,
        type: 'CUSTOMER' as const,
        isActive: true,
        lastLoginAt: null,
      };
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        region: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
    if (!staff) throw new NotFoundException('User not found');
    return { ...staff, type: 'STAFF' as const, profilePhotoUrl: null };
  }
}
