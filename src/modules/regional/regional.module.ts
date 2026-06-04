import { Module } from '@nestjs/common';
import { RegionalController } from './regional.controller';
import { RegionalService } from './regional.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [RegionalController],
  providers: [RegionalService],
  exports: [RegionalService],
})
export class RegionalModule {}
