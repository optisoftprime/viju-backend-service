import { Module } from '@nestjs/common';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';
import { ErpOrderLinesService } from './erp-order-lines.service';
import { ErpWaybillsService } from './erp-waybills.service';
import { DefaultOfficerService } from './default-officer.service';

@Module({
  controllers: [ErpController],
  providers: [
    ErpService,
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpOrderLinesService,
    ErpWaybillsService,
    DefaultOfficerService,
  ],
  exports: [
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpOrderLinesService,
    ErpWaybillsService,
    DefaultOfficerService,
  ],
})
export class ErpModule {}
