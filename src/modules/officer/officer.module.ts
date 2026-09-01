import { Module } from '@nestjs/common';
import { OfficerController } from './officer.controller';
import { OfficerService } from './officer.service';
import { ErpModule } from '../erp/erp.module';
import { RegionalModule } from '../regional/regional.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  // ErpModule supplies ErpAccountBalanceService: the officer portal shows
  // the same ERP-derived balance the distributor sees on GET /customers/me,
  // rather than the stored column the projector inverts.
  //
  // A-1: RegionalModule supplies RegionalService, whose loading-request list,
  // assign and cancel are reused verbatim with an officer scope instead of a
  // region — so the two portals cannot drift in row shape or rules.
  //
  // CustomerModule supplies CustomerService, whose invoice, stock-balance and
  // ERP-waybill readers serve the per-customer tabs unchanged - the officer
  // sees byte-identical responses to the distributor's own. CustomerModule
  // imports only ErpModule, so there is no cycle.
  imports: [ErpModule, RegionalModule, CustomerModule],
  controllers: [OfficerController],
  providers: [OfficerService],
})
export class OfficerModule {}
