import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ErpService } from './erp.service';
import {
  SyncBalanceDto,
  SyncPurchaseDto,
  SyncPaymentDto,
  SyncStockDto,
} from './dto/erp.dto';

// In production, require an API key guard or strict IP Whitelisting
@ApiTags('ERP Webhooks')
@Controller('erp')
export class ErpController {
  constructor(private readonly erpService: ErpService) {}

  @Post('sync/balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update customer outstanding balance from ERP' })
  async syncBalance(@Body() dto: SyncBalanceDto) {
    await this.erpService.syncBalance(dto);
    return { success: true, message: 'Balance synced successfully' };
  }

  @Post('sync/stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update product stock availability from ERP' })
  async syncStock(@Body() dto: SyncStockDto) {
    await this.erpService.syncStock(dto);
    return { success: true, message: 'Stock synced successfully' };
  }

  @Post('sync/purchases')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync customer purchase order creation/update from ERP',
  })
  async syncPurchase(@Body() dto: SyncPurchaseDto) {
    await this.erpService.syncPurchase(dto);
    return { success: true, message: 'Purchase synced successfully' };
  }

  @Post('sync/payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync customer payment receipts from ERP' })
  async syncPayment(@Body() dto: SyncPaymentDto) {
    await this.erpService.syncPayment(dto);
    return { success: true, message: 'Payment synced successfully' };
  }
}
