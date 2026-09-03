import { Module } from '@nestjs/common';
import { ErpController } from './erp.controller';
import { ErpProductsController } from './erp-products.controller';
import { ErpService } from './erp.service';
import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpCustomerProjectionService } from './erp-customer-projection.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import { ErpStockBalanceService } from './erp-stock-balance.service';
import { ErpItemCodeService } from './erp-item-code.service';
import { ErpOrderLinesService } from './erp-order-lines.service';
import { ErpWaybillsService } from './erp-waybills.service';
import { ErpFinancialRecordsService } from './erp-financial-records.service';
import { ErpCustomerProductsService } from './erp-customer-products.service';
import { DefaultOfficerService } from './default-officer.service';

@Module({
  controllers: [ErpController, ErpProductsController],
  providers: [
    ErpService,
    ErpOrderStatusService,
    ErpCustomerProjectionService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpItemCodeService,
    ErpOrderLinesService,
    ErpWaybillsService,
    ErpFinancialRecordsService,
    ErpCustomerProductsService,
    DefaultOfficerService,
  ],
  exports: [
    ErpOrderStatusService,
    ErpCustomerProjectionService,
    ErpAccountBalanceService,
    ErpStockBalanceService,
    ErpItemCodeService,
    ErpOrderLinesService,
    ErpWaybillsService,
    ErpFinancialRecordsService,
    ErpCustomerProductsService,
    DefaultOfficerService,
  ],
})
export class ErpModule {}
