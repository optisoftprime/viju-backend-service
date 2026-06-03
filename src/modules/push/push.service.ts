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
