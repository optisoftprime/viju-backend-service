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
      'ERP item code from the specification sheet. Null when the sheet does ' +
      'not cover this product, or covers it under several codes that ' +
      'disagree — never a guess.',
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
    enum: ['SPEC_AND_NAME', 'NAME', 'SPEC', 'NONE'],
    example: 'SPEC_AND_NAME',
    description:
      'How the row was matched, so a caller can judge how much to trust it. ' +
      'SPEC_AND_NAME is exact; SPEC means the size identified the weight but ' +
      'the name did not appear; NONE means the sheet has no entry and both ' +
      'other fields are null.',
  })
  matchedOn: 'SPEC_AND_NAME' | 'NAME' | 'SPEC' | 'NONE';
}
