import { Module } from '@nestjs/common';
import { RegionalController } from './regional.controller';
import { RegionalService } from './regional.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { AdminModule } from '../admin/admin.module';

@Module({
  // AdminModule is imported for AdminService only — GET /regional/customers
  // reuses the admin customer list rather than growing a second copy of it.
  imports: [NotificationModule, AdminModule],
  controllers: [RegionalController],
  providers: [RegionalService],
  exports: [RegionalService],
})
export class RegionalModule {}
