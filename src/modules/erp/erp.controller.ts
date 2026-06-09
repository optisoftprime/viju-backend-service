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
import { ErpSyncResponseDto } from './dto/erp-response.dto';
import { ErpApiKeyGuard } from '../../common/guards/erp-api-key.guard';

// ERP→app sync is server-to-server: authenticated via the x-api-key header
// (ERP_API_KEY), not JWT. Fail-closed in production.
@ApiTags('ERP Webhooks')
@ApiSecurity('x-api-key')
@ApiUnauthorizedResponse({ description: 'Missing or invalid x-api-key header' })
@UseGuards(ErpApiKeyGuard)
@Controller('erp')
export class ErpController {
  constructor(private readonly erpService: ErpService) {}

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
}
