import { Module } from '@nestjs/common';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';
import { DefaultOfficerService } from './default-officer.service';

@Module({
  controllers: [ErpController],
  providers: [
    ErpService,
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    DefaultOfficerService,
  ],
  exports: [
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    DefaultOfficerService,
  ],
})
export class ErpModule {}
