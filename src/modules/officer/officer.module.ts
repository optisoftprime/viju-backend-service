import { Module } from '@nestjs/common';
import { OfficerController } from './officer.controller';
import { OfficerService } from './officer.service';
import { ErpModule } from '../erp/erp.module';

@Module({
  // ErpModule supplies ErpAccountBalanceService: the officer portal shows
  // the same ERP-derived balance the distributor sees on GET /customers/me,
  // rather than the stored column the projector inverts.
  imports: [ErpModule],
  controllers: [OfficerController],
  providers: [OfficerService],
})
export class OfficerModule {}
