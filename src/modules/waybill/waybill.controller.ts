import {
  Controller,
  Get,
  Post,
  Patch,
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
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiParam,
} from '@nestjs/swagger';
import { WaybillService } from './waybill.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AcceptTermsDto,
  SubmitLoadingRequestDto,
  UpdateLoadingRequestDto,
  WaybillListQueryDto,
} from './dto/waybill.dto';
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
  async list(@CurrentUser() user: any, @Query() query: WaybillListQueryDto) {
    return this.waybillService.listForCustomer(user.id, query);
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
      'PRODUCT BREAKDOWN: send `products` - a flat array of the lines being ' +
      'loaded, e.g. `[{ "productName": "750ml water(L-水)", ' +
      '"quantityToLoad": 120, "quantityLeft": 200 }]`.\n\n' +
      'REMOVED: `orders` and `linkedPurchaseId`. A request is filed against ' +
      'the ACCOUNT, not against a document - the distributor picks from ' +
      'GET /erp/orders/{customerId}/products, which is everything they still ' +
      'have to collect across ALL their open orders in the ERP sales-order ' +
      'feed. There was nothing left for the client to state. Sending either ' +
      'field now returns 400 (the API rejects unknown properties), so drop ' +
      'them from the body rather than leaving them in.\n\n' +
      'Consequently `reference` is now `LR-<erpCode>-<yyyymmdd>` rather than ' +
      'an order DOC_NO, and `linkedPurchaseIds` comes back empty. Nothing ' +
      'else about the response changes.\n\n' +
      'Echo `productId`, `spec`, `quantityLeft` and `weightPerCarton` back ' +
      'as the products endpoint returned them - `productId`, `spec` and ' +
      '`weightPerCarton` may be null, because the product specification ' +
      'sheet does not cover every product. The lines are stored as sent and ' +
      'never re-resolved, so a later correction to the sheet cannot change ' +
      'what the distributor declared.\n\n' +
      'QUANTITY LIMIT: `quantityToLoad` may not exceed what is left to ' +
      'collect, or the request is refused with 400. It is checked against ' +
      'the `quantityLeft` on the line AND, independently, against the ' +
      "ERP's own outstanding quantity for that product - summed across " +
      'every line naming it, so three lines of 100 against 150 left is ' +
      'refused even though no single line is over.\n\n' +
      '`warehouseName` is one of LAGOS WAREHOUSE | OGUN WAREHOUSE | ABUJA ' +
      'WAREHOUSE. `loadingCapacity` is the TRUCK’s carton capacity, not the ' +
      'size of this load.\n\n' +
      '`quantityCartons` is DERIVED as the sum of the line quantities and ' +
      'any value sent for it is ignored - so the stock figures that read ' +
      'that column cannot disagree with the lines.',
  })
  @ApiCreatedResponse({ type: WaybillDto })
  async submit(@CurrentUser() user: any, @Body() dto: SubmitLoadingRequestDto) {
    return this.waybillService.submitLoadingRequest(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a loading request that has not been acted on yet',
    description:
      'Send only what changed; anything omitted is left as it is.\n\n' +
      'ONLY WHILE `PENDING_ASSIGNMENT`. Once a regional admin has assigned ' +
      'the request, or an officer has started loading, people are working ' +
      'to what it says - moving the quantities underneath them would put ' +
      'the truck and the paperwork out of step. Those answer **409**, not ' +
      '403: the request is real and yours, it is the STATE that refuses. ' +
      'Cancel it and raise a new one.\n\n' +
      'PRODUCT LINES ARE REPLACED WHOLESALE when `products` or `orders` is ' +
      'present - a partial line list has no meaning a form can express. ' +
      'Omit both to leave them alone; send `[]` to clear them.\n\n' +
      '`loadingCapacity` is re-checked against the MERGED result, so ' +
      'editing quantities and leaving the old capacity behind is refused. ' +
      'Resend both together.\n\n' +
      '`reference` never changes: it is what the depot and the ERP know ' +
      'the request by.',
  })
  @ApiParam({ name: 'id', description: 'The loading request id' })
  @ApiOkResponse({ type: WaybillDetailDto })
  @ApiNotFoundResponse({
    description: 'No such loading request for this distributor',
  })
  @ApiConflictResponse({
    description:
      'The request has been assigned, loaded, completed or cancelled',
  })
  @ApiBadRequestResponse({
    description: '`loadingCapacity` no longer equals the weight of the load',
  })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateLoadingRequestDto,
  ) {
    return this.waybillService.updateLoadingRequest(user.id, id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One loading request in full - the submitted-request preview',
    description:
      'Everything recorded when the request was raised: the truck and driver, ' +
      'the warehouse, the requested date, the status, and the whole load.\n\n' +
      'THE LOAD IS RETURNED TWICE, deliberately. `products` is the flat list ' +
      'of lines, unchanged, for callers that already read it. `orders` is the ' +
      'same lines GROUPED BY ORDER - primary first - each entry carrying that ' +
      'order`s DOC_NO, date and status plus its own carton and kilogram ' +
      'totals. A preview screen wants `orders`.\n\n' +
      '`totals` sums the load across every order. `totalCartons` equals ' +
      '`quantityCartons`. `weightIsComplete` is false when any line has no ' +
      'carton weight - the product specification sheet does not cover every ' +
      'product - so the kilogram figure is then a partial sum and should be ' +
      'shown as a minimum rather than as the total.\n\n' +
      'Scoped to the caller: another distributor`s request id returns 404, ' +
      'not 403. The assigned officer is always the generic label ' +
      '`Viju Loading Officer` (PRD F6), never a real name.',
  })
  @ApiOkResponse({ type: WaybillDetailDto })
  @ApiNotFoundResponse({
    description:
      'No such loading request for this distributor: ' +
      '`{ "message": "Waybill not found", "statusCode": 404 }`',
  })
  async detail(@CurrentUser() user: any, @Param('id') id: string) {
    return this.waybillService.getForCustomer(user.id, id);
  }
}
