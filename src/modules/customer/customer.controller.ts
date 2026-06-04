import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Query,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  UpdateProfilePhotoDto,
  ChangePasswordDto,
  PurchaseFilterDto,
} from './dto/customer.dto';

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('me/home')
  @ApiOperation({
    summary: 'Mobile home screen aggregate (PRD F2)',
    description:
      'Returns the four blocks the home screen needs in one call: ' +
      'Account Balance card, Stock Balance card, scrollable product flyers, ' +
      'and the last 5 purchases. Stock balance is derived from purchases minus ' +
      'completed loading-request quantities.',
  })
  async getHome(@CurrentUser() user: any) {
    return this.customerService.getHome(user.id);
  }

  @Get('me/stock-balance')
  @ApiOperation({
    summary: 'Stock Balance per-product breakdown (PRD F2 AC4)',
    description:
      'Returns paid / loaded / remaining quantities per product, shown when ' +
      'the distributor taps the Stock Balance card. Loaded qty is apportioned ' +
      'across products on each purchase proportionally to ordered quantity ' +
      '(mocked until ERP exposes per-product loading detail).',
  })
  async getStockBalance(@CurrentUser() user: any) {
    return this.customerService.getStockBalanceBreakdown(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current customer profile and balance' })
  async getProfile(@CurrentUser() user: any) {
    return this.customerService.getProfile(user.id);
  }

  @Patch('me/photo')
  @ApiOperation({ summary: 'Update customer profile photo' })
  async updatePhoto(
    @CurrentUser() user: any,
    @Body() dto: UpdateProfilePhotoDto,
  ) {
    return this.customerService.updatePhoto(user.id, dto);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change customer password' })
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.customerService.changePassword(user.id, dto);
    return { message: 'Password updated successfully' };
  }

  @Get('me/purchases')
  @ApiOperation({ summary: 'Get customer purchase history' })
  async getPurchases(
    @CurrentUser() user: any,
    @Query() filter: PurchaseFilterDto,
  ) {
    return this.customerService.getPurchases(user.id, filter);
  }

  @Get('me/purchases/:id')
  @ApiOperation({
    summary: 'Order detail with line items + linked invoice (PRD F3 AC2)',
    description:
      'Tapping any order on the Payment tab opens this detail view: ' +
      'individual product lines, status, and the derived invoice number. ' +
      'Invoice number is generated from the order ERP id until ERP supplies ' +
      'the real link.',
  })
  async getPurchaseDetail(
    @CurrentUser() user: any,
    @Param('id') purchaseId: string,
  ) {
    return this.customerService.getPurchaseDetail(user.id, purchaseId);
  }

  @Get('me/payments')
  @ApiOperation({ summary: 'Get customer payment history' })
  async getPayments(@CurrentUser() user: any) {
    return this.customerService.getPayments(user.id);
  }
}
