import { ApiProperty } from '@nestjs/swagger';

/**
 * One product a customer has ordered, carried through the Viju product
 * specification sheet for its code and carton weight.
 */
export class ErpCustomerProductDto {
  @ApiProperty({
    example: '101020104',
    nullable: true,
    description:
      'ERP item code. Taken from the order`s own lines where the feed states ' +
      'one, else from what the feed states for this product anywhere, else ' +
      'from the Viju specification sheet. Null only when no source names it — ' +
      'never a guess.',
  })
  productId: string | null;

  @ApiProperty({
    example: '750ml water(L-水)',
    description:
      'ITEM_DESCRIPTION from the ERP sales-order feed, verbatim. The ' +
      'specification sheet is consulted for the code and weight, never to ' +
      'rename the product.',
  })
  productName: string;

  @ApiProperty({
    example: '750ML(L)',
    nullable: true,
    description:
      'ITEM_SPECIFICATION from the sales-order feed, with the ERP`s Chinese ' +
      'category characters stripped - `100ML` from `100ML中性`. Null where the ' +
      'feed states none.' +
      '\n\n' +
      'It is what separates two products the feed gives the SAME name: ' +
      'VIJU MULIIFRUIT FURIT JUICE ships as both 100ML and 200ML. Show it ' +
      'beside the name, and send it back on the loading request.',
  })
  spec: string | null;

  @ApiProperty({
    example: 9.38,
    nullable: true,
    description:
      'Kilograms per carton, from the specification sheet. Null when the ' +
      'sheet does not cover this product — check before doing arithmetic.',
  })
  weightPerCarton: number | null;

  @ApiProperty({
    example: 20,
    description:
      'Cartons of this product still to collect ON THIS ORDER: ' +
      'SUM(BUSINESS_QTY - DELIVERED_BUSINESS_QTY) over the order`s lines for ' +
      'it. Floored at zero — the feed carries a few lines delivered above ' +
      'what was ordered.' +
      '\n\n' +
      'This is the ceiling for a loading request against this order. It is ' +
      'per ORDER, not the distributor`s whole stock balance, which is on ' +
      'GET /customers/me/stock-balance.',
  })
  quantityLeft: number;
}
