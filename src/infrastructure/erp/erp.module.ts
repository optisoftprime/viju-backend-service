import { Module } from '@nestjs/common';
import { ErpService } from './erp.types';
import { MockErpService } from './mock-erp.service';

@Module({
  providers: [
    {
      provide: ErpService,
      useClass: MockErpService,
    },
  ],
  exports: [ErpService],
})
export class ErpModule {}
