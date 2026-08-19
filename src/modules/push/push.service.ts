import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DevicePlatform } from '@prisma/client';

interface RegisterArgs {
  token: string;
  platform: DevicePlatform;
  recipientType: 'CUSTOMER' | 'STAFF';
  recipientId: string;
}

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  async register(args: RegisterArgs) {
    return this.prisma.pushToken.upsert({
      where: { token: args.token },
      update: {
        platform: args.platform,
        customerId: args.recipientType === 'CUSTOMER' ? args.recipientId : null,
        staffId: args.recipientType === 'STAFF' ? args.recipientId : null,
        isActive: true,
        lastUsedAt: new Date(),
      },
      create: {
        token: args.token,
        platform: args.platform,
        customerId: args.recipientType === 'CUSTOMER' ? args.recipientId : null,
        staffId: args.recipientType === 'STAFF' ? args.recipientId : null,
        lastUsedAt: new Date(),
      },
      // Don't echo the device token back — the caller already holds it,
      // and reflecting it only widens its exposure surface.
      omit: { token: true },
    });
  }

  async unregister(token: string) {
    await this.prisma.pushToken.updateMany({
      where: { token },
      data: { isActive: false },
    });
    return { success: true };
  }
}
