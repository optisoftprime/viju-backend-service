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
 * Products on one ERP sales order.
 *
 * Open to distributors as well as staff: the id this takes is the one
 * `linkedPurchaseId` carries on GET /customers/me/waybills, so the natural
 * caller is the distributor app asking what is on the order a loading request
 * is against. A CUSTOMER is scoped to their OWN orders - another distributor's
 * order id reads as unknown - while staff may read any.
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

  @Get(':orderId/products')
  @ApiOperation({
    summary: 'Products on one sales order, with carton weights',
    description:
      'One entry per DISTINCT product on the order, ordered by name. The ERP ' +
      'feed holds a row per order LINE, so several lines of the same product ' +
      'collapse to one entry.\n\n' +
      '`orderId` is the id `linkedPurchaseId` carries on ' +
      'GET /customers/me/waybills, so a distributor holding a loading request ' +
      'can ask what is on the order it is against.\n\n' +
      '`productName` is the feed’s own ITEM_DESCRIPTION, verbatim. ' +
      '`productId` and `weightPerCarton` come from the Viju product ' +
      'specification sheet.\n\n' +
      'MATCHING: the sheet’s product names are NOT unique — 11 of them carry ' +
      'more than one code and weight, because the same drink ships in several ' +
      'sizes (VIJU WHEAT MILK is 4.22 kg/carton at 320ML and 6.6 kg at ' +
      '500ML). ITEM_SPECIFICATION is what disambiguates, and every spec in ' +
      'the sheet maps to exactly one weight. So the match runs spec+name, ' +
      'then an unambiguous name, then spec alone. `matchedOn` reports which ' +
      'applied.\n\n' +
      'A product the sheet does not cover returns `productId: null` and ' +
      '`weightPerCarton: null` with `matchedOn: "NONE"` rather than a guessed ' +
      'weight — 18.9L water and the cracker lines are absent from the sheet ' +
      'today. Check for null before doing arithmetic.\n\n' +
      'A CUSTOMER may only read their OWN orders; another distributor’s order ' +
      'id returns `[]`. An absent ERP feed or an unknown order also returns ' +
      '`[]`, never an error.',
  })
  @ApiParam({
    name: 'orderId',
    description:
      'The order. Either a `Purchase.id` uuid — what `linkedPurchaseId` on ' +
      'GET /customers/me/waybills carries — or the ERP DOC_NO held as ' +
      '`Purchase.erpId` (e.g. `2310-202606110033`). Both are accepted.',
    example: '2310-202606110033',
  })
  @ApiOkResponse({ type: [ErpCustomerProductDto] })
  async listForOrder(
    @CurrentUser() user: { id: string; role: string },
    @Param('orderId') orderId: string,
  ) {
    // A distributor is pinned to their own orders; staff pass no customer
    // scope and may read any order.
    return this.products.listForOrder(
      orderId,
      user.role === 'CUSTOMER' ? user.id : undefined,
    );
  }
}
