import { Module } from '@nestjs/common';
import { ErpController } from './erp.controller';
import { ErpProductsController } from './erp-products.controller';
import { ErpService } from './erp.service';
import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';
import { ErpOrderLinesService } from './erp-order-lines.service';
import { ErpWaybillsService } from './erp-waybills.service';
import { ErpCustomerProductsService } from './erp-customer-products.service';
import { DefaultOfficerService } from './default-officer.service';

@Module({
  controllers: [ErpController, ErpProductsController],
  providers: [
    ErpService,
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpOrderLinesService,
    ErpWaybillsService,
    ErpCustomerProductsService,
    DefaultOfficerService,
  ],
  exports: [
    ErpOrderStatusService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpOrderLinesService,
    ErpWaybillsService,
    ErpCustomerProductsService,
    DefaultOfficerService,
  ],
})
export class ErpModule {}
