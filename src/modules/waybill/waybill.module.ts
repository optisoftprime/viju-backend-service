import { Module } from '@nestjs/common';
import { WaybillController } from './waybill.controller';
import { WaybillService } from './waybill.service';
import { NotificationModule } from '../../infrastructure/notification/notification.module';
import { ErpModule } from '../erp/erp.module';

@Module({
  // ErpModule for ErpCustomerProductsService: submission checks every
  // quantityToLoad against what the ERP says is still left to collect.
  imports: [NotificationModule, ErpModule],
  controllers: [WaybillController],
  providers: [WaybillService],
  exports: [WaybillService],
})
export class WaybillModule {}
