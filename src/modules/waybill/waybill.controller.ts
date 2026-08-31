import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { WaybillService } from './waybill.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AcceptTermsDto, SubmitLoadingRequestDto } from './dto/waybill.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  PaginatedWaybillsResponseDto,
  AcceptTermsResponseDto,
  WaybillDto,
  WaybillDetailDto,
} from './dto/waybill-response.dto';

@ApiTags('Customer Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@Controller('customers/me/waybills')
export class WaybillController {
  constructor(private readonly waybillService: WaybillService) {}

  @Get()
  @ApiOperation({
    summary: 'List the distributor’s loading requests / waybills',
  })
  @ApiOkResponse({ type: PaginatedWaybillsResponseDto })
  async list(
    @CurrentUser() user: any,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.waybillService.listForCustomer(user.id, pagination);
  }

  @Post('accept-terms')
  @ApiOperation({
    summary: 'Record T&C acceptance, return external loading form URL',
    description:
      'Must be called before /customers/me/waybills POST or before the FE ' +
      'opens the external Google Form. The acceptance is valid for 1 hour.',
  })
  @ApiCreatedResponse({ type: AcceptTermsResponseDto })
  async acceptTerms(@CurrentUser() user: any, @Body() dto: AcceptTermsDto) {
    return this.waybillService.acceptTermsAndGetFormUrl(user.id, dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Submit a loading request',
    description:
      'Requires a T&C acceptance within the last hour (POST ' +
      '/customers/me/waybills/accept-terms). Returns the created request in ' +
      'PENDING_ASSIGNMENT status; the regional admin for the region is ' +
      'notified.\n\n' +
      'PRODUCT BREAKDOWN: send `orders` - an object keyed by ORDER, each ' +
      'key holding the lines taken from that order, e.g. ' +
      '`{ "2310-202606110033": [{ "productName": "750ml water", ' +
      '"quantity": 120 }] }`. One truck is loaded against more than one ' +
      'sales order, so a request may name several. Each key is either the ' +
      '`Purchase.id` uuid that `linkedPurchaseId` carries or the ERP ' +
      'DOC_NO; both work, and every order named must belong to the caller ' +
      'or the request is rejected with 400.\n\n' +
      'The lines for an order come from GET /erp/orders/{orderId}/products ' +
      'for that same order. Echo `productId` and `weightPerCarton` back as ' +
      'that endpoint returned them - both may be null, because the product ' +
      'specification sheet does not cover every product. The lines are ' +
      'stored as sent and never re-resolved, so a later correction to the ' +
      'sheet cannot change what the distributor declared. They come back on ' +
      'the response as `products[]`, each carrying `purchaseId` and ' +
      '`orderReference`, so the app can group them by order again.\n\n' +
      '`products[]` is still accepted on the way IN as the single-order ' +
      'form: its lines are attributed to `linkedPurchaseId`. `orders` wins ' +
      'if a body sends both. `linkedPurchaseId` stays REQUIRED either way - ' +
      'it is the order the request is filed under and the one its reference ' +
      'is drawn from.\n\n' +
      '`warehouseName` is one of LAGOS WAREHOUSE | OGUN WAREHOUSE | ABUJA ' +
      'WAREHOUSE. `loadingCapacity` is the TRUCK’s carton capacity, not the ' +
      'size of this load.\n\n' +
      'When any lines are present, `quantityCartons` is DERIVED as the sum ' +
      'of the line quantities ACROSS EVERY ORDER and any value sent for it ' +
      'is ignored - so the stock figures that read that column cannot ' +
      'disagree with the lines. With no lines at all the endpoint behaves ' +
      'exactly as before.',
  })
  @ApiCreatedResponse({ type: WaybillDto })
  async submit(@CurrentUser() user: any, @Body() dto: SubmitLoadingRequestDto) {
    return this.waybillService.submitLoadingRequest(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Waybill detail',
  })
  @ApiOkResponse({ type: WaybillDetailDto })
  async detail(@CurrentUser() user: any, @Param('id') id: string) {
    return this.waybillService.getForCustomer(user.id, id);
  }
}
