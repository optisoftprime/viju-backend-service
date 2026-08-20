import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { StatementService } from './statement.service';
import { StatementLedgerService } from './statement-ledger.service';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, StatementService, StatementLedgerService],
  exports: [CustomerService],
})
export class CustomerModule {}
