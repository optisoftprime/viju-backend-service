import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConsoleNotificationGateway } from './console-notification.gateway';
import { FcmNotificationGateway } from './fcm-notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.types';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: NotificationGateway,
      // PUSH_PROVIDER=fcm → Firebase Cloud Messaging
      // anything else → console logger (dev default)
      useClass:
        process.env.PUSH_PROVIDER === 'fcm'
          ? FcmNotificationGateway
          : ConsoleNotificationGateway,
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
