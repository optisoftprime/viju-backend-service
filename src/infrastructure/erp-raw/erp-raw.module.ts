import { Global, Module } from '@nestjs/common';
import { ErpRawService } from './erp-raw.service';

/**
 * Read-only access to the ERP landing schema. Global because reconciliation
 * counts are needed by the admin, regional and customer portals alike.
 */
@Global()
@Module({
  providers: [ErpRawService],
  exports: [ErpRawService],
})
export class ErpRawModule {}
