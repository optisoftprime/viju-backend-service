import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { EmailModule } from '../../infrastructure/email/email.module';
import { ErpModule } from '../erp/erp.module';

@Module({
  imports: [NotificationModule, EmailModule, ErpModule],
  controllers: [AdminController],
  providers: [AdminService],
  // RA-C2: the regional portal serves its own customer list through the SAME
  // service, so the two lists cannot drift in shape, sorting or ERP columns.
  exports: [AdminService],
})
export class AdminModule {}
