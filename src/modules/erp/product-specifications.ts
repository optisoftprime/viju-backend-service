/**
 * Viju product specifications, generated from `viju_product_specifiaction.md`.
 *
 * EMBEDDED RATHER THAN READ AT RUNTIME: `.dockerignore` excludes `*.md`, so the
 * markdown file does not exist inside the container. Reading it at runtime
 * would work on a developer machine and quietly return nothing in production -
 * the worst kind of failure. Regenerate this table when the markdown changes.
 *
 * Columns map onto the ERP sales-order feed as:
 *   spec         <- ITEM_SPECIFICATION
 *   productName  <- ITEM_DESCRIPTION
 *   itemCode     -> returned as `productId`
 */
export interface ProductSpecification {
  /** ERP ITEM_SPECIFICATION, e.g. '750ML(L)'. */
  spec: string;
  /** ERP item code, e.g. '101020104'. Returned as `productId`. */
  itemCode: string;
  /** ERP item name as the specification sheet spells it. */
  productName: string;
  /** Kilograms per carton. */
  weightPerCarton: number;
}

export const PRODUCT_SPECIFICATIONS: readonly ProductSpecification[] = [
  {
    spec: '100ML中性',
    itemCode: '101011501',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML中性',
    itemCode: '101011501',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML中性',
    itemCode: '101011502',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML中性',
    itemCode: '101011502',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML果汁',
    itemCode: '101011803',
    productName: 'VIJU ORANGE FURIT JUICE',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML果汁奶',
    itemCode: '101011503',
    productName: 'V-CLASSIC APPLE FRUIT MILK DRINK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML果汁奶',
    itemCode: '101011504',
    productName: 'V-CLASSIC ORANGE FRUIT MILK DRINK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '100ML果汁奶',
    itemCode: '101011505',
    productName: 'V-CLASSIC PINEAPPLE FRUIT MILK DRINK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '150ML果味(O)',
    itemCode: '101011007',
    productName: 'viju apple bbstar milk(O)',
    weightPerCarton: 3.8,
  },
  {
    spec: '150ML果味（O）',
    itemCode: '101011007',
    productName: 'viju apple bbstar milk(O)',
    weightPerCarton: 3.8,
  },
  {
    spec: '150ML果味(O)/24',
    itemCode: '101011010',
    productName: 'viju apple bbstar milk(O)',
    weightPerCarton: 3.8,
  },
  {
    spec: '18.9L*1/BOTTLE(Lagos）',
    itemCode: '101020103',
    productName: 'Mr V Premium Refil Water(Lagos)',
    weightPerCarton: 20,
  },
  {
    spec: '1L*10/CTN(Ogun）',
    itemCode: '101011701',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK',
    weightPerCarton: 11.6,
  },
  {
    spec: '1L*10/CTN(Ogun）',
    itemCode: '101011702',
    productName: 'Plain Soya Milk',
    weightPerCarton: 11.6,
  },
  {
    spec: '1L*10/CTN(Ogun）',
    itemCode: '101011705',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK',
    weightPerCarton: 11.6,
  },
  {
    spec: '1L中性',
    itemCode: '101011701',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK 1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '1L中性',
    itemCode: '101011702',
    productName: 'plain soyamilk 1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '200ML*24/CTN(Ogun）',
    itemCode: '101011602',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK',
    weightPerCarton: 5.2,
  },
  {
    spec: '200ML中性',
    itemCode: '101011601',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK',
    weightPerCarton: 5.2,
  },
  {
    spec: '200ML中性',
    itemCode: '101011601',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '200ML中性',
    itemCode: '101011602',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '200ML果汁奶',
    itemCode: '101011603',
    productName: 'V-CLASSIC APPLE FRUIT MILK DRINK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '210ML*24/CTN(Abuja）',
    itemCode: '101010323',
    productName: 'Viju Apple BBstar Milk（Abuja)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML*24/CTN(Abuja）',
    itemCode: '101010324',
    productName: 'Viju Orange BBstar Milk（Abuja)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML*24/CTN(Ogun）',
    itemCode: '101010305',
    productName: 'Viju Apple BBstar Milk（Ogun)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML*24/CTN(Ogun）',
    itemCode: '101010306',
    productName: 'Viju Orange BBstar Milk(Ogun)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML果味(A)',
    itemCode: '101010323',
    productName: 'viju apple bbstar milk(A)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML果味(O)',
    itemCode: '101010305',
    productName: 'viju apple bbstar milk(new)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML果味(O)',
    itemCode: '101010306',
    productName: 'viju orange bbstar milk(new)',
    weightPerCarton: 5.74,
  },
  {
    spec: '210ML果味（O）',
    itemCode: '101010305',
    productName: 'viju apple bbstar milk（new）',
    weightPerCarton: 5.74,
  },
  {
    spec: '320ML*12/CTN(Ogun）',
    itemCode: '101011202',
    productName: 'Viju Wheat Milk',
    weightPerCarton: 4.22,
  },
  {
    spec: '320ML*12/CTN(Ogun）',
    itemCode: '101012001',
    productName: 'viju coffee milk',
    weightPerCarton: 4.22,
  },
  {
    spec: '320ML中性奶(O)',
    itemCode: '101011201',
    productName: 'Viju Choco Milk',
    weightPerCarton: 4.22,
  },
  {
    spec: '320ML中性奶(O)',
    itemCode: '101011202',
    productName: 'Viju Wheat Milk',
    weightPerCarton: 4.22,
  },
  {
    spec: '320ML中性奶(O)',
    itemCode: '101012001',
    productName: 'viju coffee milk',
    weightPerCarton: 4.22,
  },
  {
    spec: '330ML果汁(O)',
    itemCode: '101011902',
    productName: 'viju apple fruit milk(O)',
    weightPerCarton: 4.3,
  },
  {
    spec: '500ML*12/CTN(Abuja）',
    itemCode: '101060111',
    productName: 'V-COOL COFFEE(Abuja)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML*12/CTN(Abuja）',
    itemCode: '101060112',
    productName: 'V-COOL COLA(Abuja)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML*12/CTN(Abuja）',
    itemCode: '101060113',
    productName: 'V-COOL ORANGE(Abuja)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML*12/CTN(Abuja）',
    itemCode: '101060114',
    productName: 'VIGOR ENERGY DRINK(Abuja)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML*12/CTN(Abuja）',
    itemCode: '101060115',
    productName: 'V-COOL GOLDEN KOLA(Abuja)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010401',
    productName: 'Viju Choco Milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010403',
    productName: 'Viju Wheat Milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010511',
    productName: 'Viju Apple Fruit Milk(Ogun)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010512',
    productName: 'Viju Pineapple Fruit Milk(Ogun)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010610',
    productName: 'Viju Yoghurt Plain Sweet',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML*12/CTN(Ogun）',
    itemCode: '101010611',
    productName: 'Viju Baked Yoghurt',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML中性奶(0)',
    itemCode: '101010405',
    productName: 'viju coffee milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML中性奶(O)',
    itemCode: '101010401',
    productName: 'Viju Choco Milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML中性奶(O)',
    itemCode: '101010402',
    productName: 'viju soya milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML中性奶(O)',
    itemCode: '101010403',
    productName: 'Viju Wheat Milk',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML发酵奶(O)',
    itemCode: '101010610',
    productName: '(1.0)YOGHURT DRINGKING PLAIN SWEET(纯奶味)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML发酵奶(O)',
    itemCode: '101010611',
    productName: '(1.5)BAKING YOGHURT',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML发酵奶(O)',
    itemCode: '101010611',
    productName: '(1.5)BAKING YOGHURT(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果味(O)',
    itemCode: '101010201',
    productName: 'viju apple milk(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果汁(O)',
    itemCode: '101010511',
    productName: 'viju apple fruit (new1)milk(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果汁(O)',
    itemCode: '101010512',
    productName: 'viju pineapple fruit(new1)milk(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果汁(O)',
    itemCode: '101010513',
    productName: '(1.5)MALT MILK(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果汁（O）',
    itemCode: '101010516',
    productName: 'VIJU APPLE FRUIT (CLASSIC) MILK (O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML果汁Classic（O）',
    itemCode: '101010516',
    productName: 'viju apple fruit(Classic) milk(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '500ML碳酸BLACKCURRANT',
    itemCode: '101060105',
    productName: 'V-COOL BLACKCURRANT',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸COFFEE',
    itemCode: '101060106',
    productName: 'V-COOL COFFEE',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸COFFEE(A)',
    itemCode: '101060111',
    productName: 'V-COOL COFFEE(A)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸COLA',
    itemCode: '101060107',
    productName: 'V-COOL COLA',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸COLA(A)',
    itemCode: '101060112',
    productName: 'V-COOL COLA (A)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸ENERGY',
    itemCode: '101060109',
    productName: 'VIGOR ENERGY DRINK',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸ENERGY(A)',
    itemCode: '101060114',
    productName: 'VIGOR ENERGY DRINK(A)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸ORANGE',
    itemCode: '101060108',
    productName: 'V-COOL ORANGE',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML碳酸ORANGE(A)',
    itemCode: '101060113',
    productName: 'V-COOL ORANGE(A)',
    weightPerCarton: 6.33,
  },
  {
    spec: '500ML麦汁(O)',
    itemCode: '101010513',
    productName: '(1.5)MALT MILK(O)',
    weightPerCarton: 6.6,
  },
  {
    spec: '600ML碳酸COFFEE',
    itemCode: '101060102',
    productName: 'V-COOL COFFEE',
    weightPerCarton: 7.4,
  },
  {
    spec: '600ML碳酸ORANGE',
    itemCode: '101060104',
    productName: 'V-COOL ORANGE',
    weightPerCarton: 7.4,
  },
  {
    spec: '750ML(A)',
    itemCode: '101020105',
    productName: '750ml water(A-水)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML(L)',
    itemCode: '101020104',
    productName: '750ml water(L-水)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML(O)',
    itemCode: '101020101',
    productName: '750ml water(O-水)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML(O)',
    itemCode: '101020101',
    productName: '750ml water(水)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML*12/CTN(Abuja）',
    itemCode: '101020105',
    productName: 'Mr V Premium Table Water(Abuja)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML*12/CTN(Lagos）',
    itemCode: '101020104',
    productName: 'Mr V Premium Table Water(Lagos)',
    weightPerCarton: 9.38,
  },
  {
    spec: '750ML\\*12/CTN(Ogun）',
    itemCode: '101020101',
    productName: 'Mr V Premium Table Water(Ogun)',
    weightPerCarton: 9.38,
  },
  {
    spec: '利-A-100ML果汁奶',
    itemCode: '101011503',
    productName: 'V-CLASSIC APPLE FRUIT MILK DRINK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-A-200ML果汁奶',
    itemCode: '101011603',
    productName: 'V-CLASSIC APPLE FRUIT MILK DRINK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '利-CHOCO-100ML中性',
    itemCode: '101011501',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-CHOCO-1L中性',
    itemCode: '101011704',
    productName: 'chocolate soyamilk 1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '利-CHOCO-1L中性',
    itemCode: '101011705',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '利-CHOCO-200ML中性',
    itemCode: '101011601',
    productName: 'VJOY CHOCOLATE FLAVOURED MILK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '利-SOYAMILK-1L中性',
    itemCode: '101011702',
    productName: 'plain soyamilk 1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '利-WHEAT-100ML中性',
    itemCode: '101011502',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK100',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-WHEAT-1L中性',
    itemCode: '101011701',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK 1L',
    weightPerCarton: 11.6,
  },
  {
    spec: '利-WHEAT-200ML中性',
    itemCode: '101011602',
    productName: 'VSMARTIC WHEAT FLAVOURED MILK200',
    weightPerCarton: 5.2,
  },
  {
    spec: '利-杂-200ML果汁',
    itemCode: '101010704',
    productName: 'VIJU MULIIFRUIT FURIT JUICE',
    weightPerCarton: 5.2,
  },
  {
    spec: '利-杂果-100ML果汁',
    itemCode: '101011802',
    productName: 'VIJU MULIIFRUIT FURIT JUICE',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-橙-100ML果汁',
    itemCode: '101011803',
    productName: 'VIJU ORANGE FURIT JUICE',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-橙-200ML果汁',
    itemCode: '101010705',
    productName: 'VIJU ORANGE FURIT JUICE',
    weightPerCarton: 5.2,
  },
  {
    spec: '利-黑-100ML果汁',
    itemCode: '101011801',
    productName: 'VIJU BLACKCURRANT FURIT JUICE',
    weightPerCarton: 2.7,
  },
  {
    spec: '利-黑-200ML果汁',
    itemCode: '101010703',
    productName: 'VIJU BLACKCURRANT FURIT JUICE',
    weightPerCarton: 5.2,
  },
];
