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

  @ApiProperty({
    enum: ['SPEC_AND_NAME', 'NAME', 'SPEC', 'NONE'],
    example: 'SPEC_AND_NAME',
    description:
      'How the row was matched, so a caller can judge how much to trust it. ' +
      'SPEC_AND_NAME is exact; SPEC means the size identified the weight but ' +
      'the name did not appear; NONE means the SHEET has no entry, so ' +
      '`weightPerCarton` is null — `productId` may still be set from the ERP ' +
      'feed, which is a separate source.',
  })
  matchedOn: 'SPEC_AND_NAME' | 'NAME' | 'SPEC' | 'NONE';
}
