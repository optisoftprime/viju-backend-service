import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { StatementService } from './statement.service';
import { StatementLedgerService } from './statement-ledger.service';
import { ErpModule } from '../erp/erp.module';

@Module({
  // ErpModule exports ErpAccountBalanceService, which derives the account
  // balance from the ERP credit feed. ErpModule imports nothing, so there is
  // no cycle here.
  imports: [ErpModule],
  controllers: [CustomerController],
  providers: [CustomerService, StatementService, StatementLedgerService],
  exports: [CustomerService],
})
export class CustomerModule {}
