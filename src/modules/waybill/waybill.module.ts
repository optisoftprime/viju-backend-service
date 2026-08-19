import { Module } from '@nestjs/common';
import { WaybillController } from './waybill.controller';
import { WaybillService } from './waybill.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [WaybillController],
  providers: [WaybillService],
  exports: [WaybillService],
})
export class WaybillModule {}
