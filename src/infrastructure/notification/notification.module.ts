import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConsoleNotificationGateway } from './console-notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.types';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: NotificationGateway,
      useClass: ConsoleNotificationGateway,
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
