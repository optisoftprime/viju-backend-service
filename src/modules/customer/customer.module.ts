import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { StatementService } from './statement.service';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, StatementService],
  exports: [CustomerService],
})
export class CustomerModule {}
