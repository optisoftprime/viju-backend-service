import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErpService } from './erp.service';
import {
  SyncBalanceDto,
  SyncPurchaseDto,
  SyncPaymentDto,
  SyncStockDto,
} from './dto/erp.dto';
import {
  ErpAccountBalanceSyncResponseDto,
  ErpDefaultOfficerSyncResponseDto,
  ErpCustomerProjectionSyncResponseDto,
  ErpOrderStatusSyncResponseDto,
  ErpSyncResponseDto,
} from './dto/erp-response.dto';
import { ErpApiKeyGuard } from '../../common/guards/erp-api-key.guard';
import { ErpOrderStatusService } from './erp-order-status.service';
import { ErpAccountBalanceService } from './erp-account-balance.service';
import { DefaultOfficerService } from './default-officer.service';
import { ErpCustomerProjectionService } from './erp-customer-projection.service';

// ERP→app sync is server-to-server: authenticated via the x-api-key header
// (ERP_API_KEY), not JWT. Fail-closed in production.
@ApiTags('ERP Webhooks')
@ApiSecurity('x-api-key')
@ApiUnauthorizedResponse({ description: 'Missing or invalid x-api-key header' })
@UseGuards(ErpApiKeyGuard)
@Controller('erp')
export class ErpController {
  constructor(
    private readonly erpService: ErpService,
    private readonly orderStatusService: ErpOrderStatusService,
    private readonly accountBalanceService: ErpAccountBalanceService,
    private readonly defaultOfficerService: DefaultOfficerService,
    private readonly customerProjection: ErpCustomerProjectionService,
  ) {}

  @Post('sync/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update customer outstanding balance from ERP' })
  @ApiOkResponse({ type: ErpSyncResponseDto })
  async syncBalance(@Body() dto: SyncBalanceDto) {
    await this.erpService.syncBalance(dto);
    return { success: true, message: 'Balance synced successfully' };
  }

  @Post('sync/stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update product stock availability from ERP' })
  @ApiOkResponse({ type: ErpSyncResponseDto })
  async syncStock(@Body() dto: SyncStockDto) {
    await this.erpService.syncStock(dto);
    return { success: true, message: 'Stock synced successfully' };
  }

  @Post('sync/purchases')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync customer purchase order creation/update from ERP',
  })
  @ApiOkResponse({ type: ErpSyncResponseDto })
  async syncPurchase(@Body() dto: SyncPurchaseDto) {
    await this.erpService.syncPurchase(dto);
    return { success: true, message: 'Purchase synced successfully' };
  }

  @Post('sync/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync customer payment receipts from ERP' })
  @ApiOkResponse({ type: ErpSyncResponseDto })
  async syncPayment(@Body() dto: SyncPaymentDto) {
    await this.erpService.syncPayment(dto);
    return { success: true, message: 'Payment synced successfully' };
  }

  @Post('sync/customers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Project ERP customers into the portal',
    description:
      'Takes no body. Inserts every customer the ERP holds in a Viju region ' +
      '(BP_CLUSTER_CODE 1-5 and 9) that has no `Customer` row yet, so the ' +
      'region-scoped screens stop rendering empty for regions the external ' +
      'projector has not reached. OTHERS was invisible everywhere for exactly ' +
      'this reason: its 58 customers had no local row.\n\n' +
      'NEVER UPDATES AN EXISTING CUSTOMER - it only fills gaps, so curated ' +
      'accounts keep their phone, officer and history. Safe to call ' +
      'repeatedly; a second pass inserts nothing.\n\n' +
      'Projected rows carry a synthetic `ERP-<CUSTOMER_CODE>` phone and no ' +
      'password, because the feed states one placeholder number for 1,897 ' +
      'customers and phone is the login identifier. They are directory ' +
      'entries until onboarding sets a real, verified number.\n\n' +
      'The app also runs this on a timer; the ingest service should call it ' +
      'as soon as a customer run finishes.',
  })
  @ApiOkResponse({ type: ErpCustomerProjectionSyncResponseDto })
  async syncCustomers(): Promise<ErpCustomerProjectionSyncResponseDto> {
    const result = await this.customerProjection.project();
    return {
      success: true,
      message: !result.available
        ? 'ERP feed (erp_raw) is not present on this database — nothing to project'
        : result.skipped
          ? 'Another instance is already projecting — nothing done'
          : `Projected ${result.inserted} ERP customer(s) into the portal`,
      inserted: result.inserted,
      available: result.available,
      skipped: result.skipped,
    };
  }

  @Post('sync/order-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-derive order statuses from the ERP sales-order feed',
    description:
      'B-5.5 — takes no body. Rolls `erp_raw.raw_sales_order` up per order and ' +
      'corrects `Purchase.status` where it disagrees with the ERP, which is how ' +
      'orders stop being reported as "Processing" forever. The app also runs ' +
      'this on a timer; the ingest service should additionally call it as soon ' +
      'as a projector run finishes, so the app reflects the ERP without waiting ' +
      'for the next tick. Safe to call repeatedly — it changes only the orders ' +
      'whose derived status differs.',
  })
  @ApiOkResponse({ type: ErpOrderStatusSyncResponseDto })
  async syncOrderStatus(): Promise<ErpOrderStatusSyncResponseDto> {
    const result = await this.orderStatusService.reconcile();
    return {
      success: true,
      message: !result.available
        ? 'ERP feed (erp_raw) is not present on this database — nothing to reconcile'
        : result.skipped
          ? 'Another instance is already reconciling — nothing done'
          : `Order statuses reconciled with the ERP (${result.updated} changed)`,
      updated: result.updated,
      available: result.available,
      skipped: result.skipped,
    };
  }

  @Post('sync/account-balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-derive customer account balances from the ERP credit feed',
    description:
      'Takes no body. Reads `erp_raw.raw_customer_credit` and recomputes ' +
      '`Customer.outstandingBalance` as:\n\n' +
      '    Running Balance = CREDIT_AMT + CREDIT_AMT1 − CREDIT_PAY\n\n' +
      'where CREDIT_AMT is the approved credit limit, CREDIT_AMT1 the ' +
      'supplementary allocation granted per FUND_DESC, and CREDIT_PAY the ' +
      'credit consumed (positive = owing, negative = in credit). The newest ' +
      'credit record per customer by EFFECTIVE_DATE governs.\n\n' +
      'This corrects a projector defect: the ingest copies raw CREDIT_PAY ' +
      'into the balance column, which inverts the sign for every customer ' +
      'holding credit. Customers with no credit record in the feed are left ' +
      'untouched rather than zeroed.\n\n' +
      'The ingest service should call this once its customer-credit projector ' +
      'run finishes. Safe to call repeatedly — it changes only the customers ' +
      'whose derived balance differs.',
  })
  @ApiOkResponse({ type: ErpAccountBalanceSyncResponseDto })
  async syncAccountBalance(): Promise<ErpAccountBalanceSyncResponseDto> {
    const result = await this.accountBalanceService.reconcile();
    return {
      success: true,
      message: !result.available
        ? 'ERP credit feed (erp_raw.raw_customer_credit) is not present on this database — nothing to reconcile'
        : result.skipped
          ? 'Another instance is already reconciling — nothing done'
          : `Account balances reconciled with the ERP (${result.updated} changed)`,
      updated: result.updated,
      available: result.available,
      skipped: result.skipped,
    };
  }

  @Post('sync/default-officer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Park LAGOS customers with no account officer on the default officer',
    description:
      'Takes no body. Assigns every LAGOS customer whose `assignedOfficerId` ' +
      'is NULL to the default account officer (DEFAULT_ACCOUNT_OFFICER_EMAIL, ' +
      'defaulting to james.o@viju.example), writing both the primary pointer ' +
      'and the CustomerOfficer join row so chat, tickets and notifications ' +
      'reach them.\n\n' +
      'Customers arrive from the ERP with no officer because the ingest ' +
      'projector does not know about staff. The app also runs this on a ' +
      'timer; the ingest service should additionally call it as soon as a ' +
      'customer projector run finishes, so new distributors get an officer ' +
      'without waiting for the next tick.\n\n' +
      'SCOPED TO ONE REGION (DEFAULT_ACCOUNT_OFFICER_REGION, LAGOS by ' +
      'default). Customers in EASTERN, SOUTH_SOUTH, WESTERN and NORTH are ' +
      'left unassigned for a regional officer to pick up.\n\n' +
      'Never overrides an admin reassignment — a customer who already has an ' +
      'officer is skipped, so this is safe to call repeatedly.',
  })
  @ApiOkResponse({ type: ErpDefaultOfficerSyncResponseDto })
  async syncDefaultOfficer(): Promise<ErpDefaultOfficerSyncResponseDto> {
    const result = await this.defaultOfficerService.reconcile();
    return {
      success: true,
      message: !result.available
        ? `No active officer with email ${result.officerEmail} — nothing was assigned`
        : result.skipped
          ? 'Another instance is already assigning — nothing done'
          : `Parked ${result.assigned} unassigned ${result.region} customer(s) on ${result.officerEmail}`,
      assigned: result.assigned,
      officerEmail: result.officerEmail,
      region: result.region,
      available: result.available,
      skipped: result.skipped,
    };
  }
}
