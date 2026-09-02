import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErpCustomerProductsService } from './erp-customer-products.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ErpCustomerProductDto } from './dto/erp-product-response.dto';

/**
 * What a distributor still has to collect.
 *
 * Open to distributors as well as staff. A CUSTOMER is pinned to their own
 * stock - their token decides the account, and a path parameter naming anyone
 * else reads as empty rather than being obeyed - while staff may read any
 * distributor.
 */
@ApiTags('ERP Webhooks')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Missing, invalid or expired access token',
})
@ApiForbiddenResponse({
  description:
    'Caller is neither a distributor nor staff: ' +
    '`{ "message": "You do not have permission to perform this action.", "statusCode": 403 }`',
})
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER', 'ADMIN', 'REGIONAL_ADMIN', 'OFFICER')
@Controller('erp/orders')
export class ErpProductsController {
  constructor(private readonly products: ErpCustomerProductsService) {}

  @Get(':customerId/products')
  @ApiOperation({
    summary: 'What a distributor still has to collect, product by product',
    description:
      'The picker behind a loading request. A request is filed against the ' +
      'ACCOUNT rather than a single order, so this lists the ' +
      'distributor`s whole outstanding stock.\n\n' +
      'ONE ENTRY PER PRODUCT, only where something is still to collect - a ' +
      'product taken in full is not something a truck can be loaded with.\n\n' +
      '`quantityLeft` is the SAME figure GET /customers/me/stock-balance ' +
      'reports as `quantityRemaining`, from the same query: ' +
      'SUM(BUSINESS_QTY1 - DELIVERED_BUSINESS_QTY) over OPEN, APPROVED ' +
      'orders. The picker and the stock screen cannot disagree.\n\n' +
      '`productName` is the feed`s own ITEM_DESCRIPTION, verbatim. `spec` ' +
      'is ITEM_SPECIFICATION with the ERP`s Chinese category characters ' +
      'stripped, and is what separates two products the feed gives the ' +
      'same name - VIJU MULIIFRUIT FURIT JUICE ships as both 100ML and ' +
      '200ML. `productId` and `weightPerCarton` come from the ERP feed and ' +
      'the Viju specification sheet.\n\n' +
      'ANY OF THE THREE MAY BE NULL where no source states them - 33 of the ' +
      'feed`s 152 products have no item code anywhere, and the sheet does ' +
      'not cover packaging film or freight lines. Check before doing ' +
      'arithmetic; never substitute 0.\n\n' +
      'CHANGED: this route took an ORDER id and listed that one document`s ' +
      'products. It now takes a DISTRIBUTOR id, because a loading request ' +
      'no longer names an order.\n\n' +
      'A CUSTOMER may only read their OWN stock; another distributor`s id ' +
      'returns `[]`, as does an unknown one or an absent feed - never an ' +
      'error, so a picker renders empty rather than breaking.',
  })
  @ApiParam({
    name: 'customerId',
    description:
      'The distributor. Either the local `Customer.id` uuid or the ERP ' +
      'CUSTOMER_CODE (`erpId`, e.g. `10110003`). Both are accepted.',
    example: 'f4065cfe-682e-4864-9e7a-49e0a3b0f244',
  })
  @ApiOkResponse({ type: [ErpCustomerProductDto] })
  async listForCustomer(
    @CurrentUser() user: { id: string; role: string },
    @Param('customerId') customerId: string,
  ) {
    // A distributor is pinned to their own stock; staff may read any.
    return this.products.listForCustomer(
      customerId,
      user.role === 'CUSTOMER' ? user.id : undefined,
    );
  }
}
