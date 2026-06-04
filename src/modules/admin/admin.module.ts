import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { EmailModule } from '../../infrastructure/email/email.module';

@Module({
  imports: [NotificationModule, EmailModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
