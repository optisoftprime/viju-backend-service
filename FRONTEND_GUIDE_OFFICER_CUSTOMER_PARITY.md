# Frontend Guide — Officer tabs now mirror the distributor app

**For:** the account-officer / admin web portal
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` → *Officer Portal*

Five officer endpoints changed and **two are new**. Each one now returns the
same data, in the same shape, as the screen the distributor sees in their own
app — because they are served by the **same backend reader**, not by a second
implementation that happens to agree today.

Every example below was captured from live data (officer *Funmi Adelaja*,
distributor *ADLAK*).

---

## 1. What changed, at a glance

| Endpoint | Before | Now |
|---|---|---|
| `GET /officers/customers/{id}/invoices` | `invoices[]`, one unpaged array **with** line items | `data[]` + `meta`, paginated, **no** line items |
| `GET /officers/customers/{id}/invoices/{invoiceId}` | — | **NEW** — one order with merged product lines |
| `GET /officers/customers/{id}/stock` | `catalogue[]` of every product with reserved / awaiting figures | ERP stock **balance**: totals + `products[]` still to collect |
| `GET /officers/stock` | paginated catalogue of ERP stock **levels** | stock **balance** across the whole portfolio |
| `GET /officers/customers/{id}/waybills` | the portal's **loading requests** | the **ERP's own** goods-movement documents |
| `GET /officers/customers/{id}/waybills/{docNo}` | — | **NEW** — one ERP document with its item lines |

> ### ⚠️ These are breaking changes
> Four response shapes changed. Read §6 before deploying the portal — there is
> a short list of exactly what to rename and where the removed data moved to.

**Scope is unchanged throughout:** an `OFFICER` sees only the distributors
assigned to them (primary or secondary); an `ADMIN` sees any distributor
(US-12.3). A distributor outside the portfolio is a **`404`**, never a `403`.

---

## 2. Invoices tab

### 2.1 The list

```http
GET /api/v1/officers/customers/{id}/invoices?page=1&pageSize=20
Authorization: Bearer <staff JWT>
```

Also accepts `search` (order id or product name), `startDate`, `endDate` —
identical to the distributor's own `/customers/me/invoices`.

```json
{
  "lastUpdated": "2026-08-31T14:28:13.895Z",
  "walletBalance": 10150600.3577,
  "paymentHistory": [
    { "id": "ac9737e6-…", "erpId": "6301-202606040149",
      "date": "2026-06-04T00:00:00.000Z", "amount": 4000000,
      "reference": "6301-202606040149", "runningBalance": 0 }
  ],
  "data": [
    {
      "id": "a1ce5c0f-36b3-4930-b4ef-8839e8f1db68",
      "erpId": "2310-202606110033",
      "customerId": "f4065cfe-…",
      "orderDate": "2026-06-11T00:00:00.000Z",
      "totalItems": 4264,
      "totalValue": 9942000,
      "status": "CLOSED",
      "statusUpdatedAt": null,
      "createdAt": "…", "updatedAt": "…"
    }
  ],
  "meta": { "total": 1179, "page": 1, "pageSize": 20, "totalPages": 59,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

**`invoices` → `data` + `meta`.** The array is paginated now. Pagination params
are `page` and **`pageSize`** (not `limit`); a `pageSize` above 200 is clamped
and `meta.pageSize` reports what was actually applied.

**Rows carry no line items.** One row per order. Open one to see its products —
that is the new detail route below. (This is why the list got fast: it no
longer runs an ERP lookup per page to fill lines nothing rendered.)

**`walletBalance` and `paymentHistory` are unchanged** and still sit alongside.
They are the tab's own figures, not part of the order list.

**`lastUpdated`** is the most recent ERP sync across the balance, the *whole*
order history and the payments (US-10.7) — not the current page, so paging
never moves the "Last updated" stamp.

### 2.2 The detail — NEW

```http
GET /api/v1/officers/customers/{id}/invoices/{invoiceId}
```

`invoiceId` is the `id` from a `data[]` row.

```json
{
  "id": "a1ce5c0f-…",
  "orderId": "2310-202606110033",
  "orderDate": "2026-06-11T00:00:00.000Z",
  "status": "CLOSED",
  "statusUpdatedAt": null,
  "totalItems": 4264,
  "totalValue": 9942000,
  "linkedInvoiceNumber": "INV-110033",
  "accountBalance": 277760253.14,
  "lines": [
    { "product": "Mr V Premium Table Water(Abuja)", "itemCode": "101020105",
      "quantity": 1768, "unitPrice": 1442.31, "amount": 2550000,
      "accountBalance": 277760253.14 },
    { "product": "V-COOL COFFEE(Abuja)", "itemCode": "101060111",
      "quantity": 2496, "unitPrice": 2961.54, "amount": 7392000,
      "accountBalance": 277760253.14 }
  ]
}
```

**One line per product.** The ERP writes a *separate* order line whenever the
same product is priced differently on one order — 1,700 cartons at ₦1,500 plus
68 more at ₦0, a free-goods allocation, both under `101020105`. Those are
merged, so the officer sees two lines rather than four.

Three consequences worth knowing:

- **`quantity` and `amount` are sums.** They still add up exactly:
  `Σ quantity = totalItems` and `Σ amount = totalValue`.
- **`unitPrice` may be an *effective* rate.** Where the merged parts disagreed
  it becomes `amount / quantity` rounded to 2dp — ₦1,442.31, not ₦1,500,
  because 1,768 × ₦1,500 would overstate the line by ₦102,000.
- **Render `amount` as given.** At two decimals the rate cannot multiply back
  to the exact naira. Never recompute a line from `quantity × unitPrice`.

`unitPrice` and `amount` are **`null`** on orders the ERP states no per-line
money for — most of them. Show a dash, not a zero.

---

## 3. Stock tab

### 3.1 One distributor

```http
GET /api/v1/officers/customers/{id}/stock
GET /api/v1/officers/customers/{id}/stock?startDate=2026-01-01&endDate=2026-06-30
```

```json
{
  "lastUpdated": "2026-08-28T23:02:01.791Z",
  "totalPurchasedCartons": 1066079,
  "totalLoadedCartons": 1059177,
  "totalRemainingCartons": 6902,
  "loadingProgress": 99,
  "products": [
    { "itemCode": "101010511", "productName": "Viju Apple Fruit Milk(Ogun)",
      "quantityPaid": 9950, "quantityLoaded": 8170, "quantityRemaining": 1780,
      "lastOrderDate": "2026-06-05" },
    { "itemCode": "101020101", "productName": "Mr V Premium Table Water(Ogun)",
      "quantityPaid": 28080, "quantityLoaded": 26728, "quantityRemaining": 1352,
      "lastOrderDate": "2026-04-29" }
  ]
}
```

**`catalogue` is gone.** It listed every product in the `Stock` table with
`reservedStock` / `awaitingLoading` / `status` figures derived from the local
tables by a *different route* from the distributor's own screen — so the two
could disagree about the same distributor. The figures now come from the one
ERP query both portals read: `SUM(BUSINESS_QTY − DELIVERED_BUSINESS_QTY)`.

**`products` holds only what is still to collect** (`quantityRemaining > 0`),
so it does **not** sum to `totalPurchasedCartons`. A distributor who has
collected everything gets an empty array with non-zero totals — that is
correct, not a bug. Render "nothing outstanding".

**Date window.** `startDate` / `endDate`, both `YYYY-MM-DD`, both **inclusive**,
either may be sent alone. It filters on the order's **document date** — the one
its ERP id encodes (`2310-202606110033` → 2026-06-11).

> The window selects orders *placed* in it, minus whatever has since been
> delivered against them, however late. So **two adjacent windows do not add up
> to the unfiltered total** — an order placed before `startDate` is excluded
> outright even if it is still uncollected. Do not present a filtered figure as
> a slice of the whole.

`startDate` after `endDate` is a **`400`**.

### 3.2 The whole portfolio

```http
GET /api/v1/officers/stock
GET /api/v1/officers/stock?startDate=2026-01-01
```

**The same shape**, plus a `customers` count — so one component can render
either screen.

```json
{
  "lastUpdated": "2026-08-28T23:02:01.791Z",
  "customers": 6,
  "totalPurchasedCartons": 8558937,
  "totalLoadedCartons": 8494669,
  "totalRemainingCartons": 64268,
  "loadingProgress": 99,
  "products": [
    { "itemCode": null, "productName": "750ml water(L-水)",
      "quantityPaid": 1234567, "quantityLoaded": 1217535,
      "quantityRemaining": 17032, "lastOrderDate": "2025-12-10" },
    { "itemCode": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
      "quantityRemaining": 8052, "lastOrderDate": "2026-06-10" }
  ]
}
```

**Products are grouped ACROSS distributors** — a product several of them hold
appears **once**, with the quantities added. This answers "what is still to
collect in my book of accounts". The per-distributor split is §3.1.

**It is not paginated.** The breakdown is one row per product still held — a
short list even across a whole portfolio (33 rows for six distributors).

**Scope:** an `OFFICER` gets their assigned distributors; an `ADMIN` gets every
distributor, matching their cross-region visibility elsewhere. `customers`
tells you how many were counted.

**`itemCode` can be `null`** — the ERP carries it on only ~6% of line rows, and
rows are grouped by product *name*. Do not use it as a React key; use
`productName`.

---

## 4. Waybills tab

### ⚠️ This tab now shows a different resource

It used to list the **loading requests raised through the portal**. It now
lists the **ERP's own goods-movement documents** — what the ERP recorded as
moved, whether or not it ever passed through the app. That is what the
distributor's own Waybills screen shows, and what an officer needs in order to
reconcile an account.

**The loading requests are not lost.** They are on
**`GET /officers/loading-requests`**, which also carries the assign and cancel
actions. If your Waybills tab had assign/cancel buttons, they belong on that
screen now.

### 4.1 The list

```http
GET /api/v1/officers/customers/{id}/waybills?page=1&pageSize=20
```

```json
{
  "lastUpdated": "2026-08-28T23:02:01.791Z",
  "data": [
    {
      "docNo": "2301-202606050009",
      "docDate": "2026-06-05", "orderDate": "2026-06-05",
      "shipTo": null,
      "lines": 2, "products": 1,
      "quantityOrdered": 525, "quantityDelivered": 0, "quantityRemaining": 525,
      "quantity": null,
      "totalAmountBeforeTax": null, "taxVat": null, "totalAmountAfterTax": null,
      "status": "PROCESSING",
      "lastChangedAt": "2026-08-25T08:30:50.220Z"
    }
  ],
  "meta": { "total": 1170, "page": 1, "pageSize": 20, "totalPages": 59,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

`raw_sales_order` is one row **per order line**, so rows are rolled up to one
per document (`DOC_NO`) — the thing a waybill actually is. `lines` reports how
many line rows collapsed into the row.

**All four money fields are `null` — not `0` — wherever the ERP states none,**
which is the majority of rows. `quantity` is the ERP's document-level
`QTY_TOTAL`, **not** the sum of the items. Treat `null` as "not stated" and
render a dash.

### 4.2 The detail — NEW

```http
GET /api/v1/officers/customers/{id}/waybills/{docNo}
```

`docNo` is the `docNo` from a row, e.g. `2301-202606050009`. The document keeps
the shape it has in the list and gains `items`:

```json
{
  "docNo": "2301-202606050009",
  "quantityOrdered": 525,
  "status": "PROCESSING",
  "items": [
    { "id": "…", "itemCode": "101010511",
      "description": "Viju Apple Fruit Milk(Ogun)", "specification": "500ML",
      "price": 5500, "quantity": 500,
      "quantityDelivered": 0, "quantityRemaining": 500,
      "totalAmountBeforeTax": 2750000, "taxVat": 206250,
      "totalAmountAfterTax": 2956250, "taxRate": 0.075 },
    { "id": "…", "itemCode": "101010511",
      "description": "Viju Apple Fruit Milk(Ogun)", "price": 0, "quantity": 25,
      "totalAmountBeforeTax": null, "taxVat": null,
      "totalAmountAfterTax": null, "taxRate": null }
  ]
}
```

One entry per ERP line row, in the ERP's own order. **Items are NOT merged
here** — unlike the invoice detail, this is the ERP document reproduced
faithfully, so the two lines above (500 priced + 25 free) both appear.

A document belonging to another distributor answers **`404`**, exactly as an
unknown one does.

---

## 5. Errors

| Status | When |
|---|---|
| `401` | missing, invalid or expired staff token |
| `404` | the distributor is not in the caller's portfolio (an `OFFICER`), or does not exist |
| `404` | the order / document does not belong to that distributor |
| `400` | `startDate` is after `endDate` |
| `400` | a date bound is not a valid `YYYY-MM-DD` |

**Scope is checked twice on the detail routes.** The distributor must be in the
caller's portfolio *and* the order or document must belong to that distributor.
Pairing an order id from outside with a customer id from inside returns `404` —
verified, not assumed.

---

## 6. Migration checklist

| # | Change | What to do |
|---|---|---|
| 1 | `invoices` → `data` + `meta` | Rename; add paging controls. `pageSize`, not `limit`. |
| 2 | List rows lost their line items | Fetch `…/invoices/{invoiceId}` when a row is opened. |
| 3 | Stock `catalogue` → totals + `products` | Rebuild the Stock tab around the four totals and the outstanding-products list. |
| 4 | `/officers/stock` no longer paginated | Drop the pager; there is no `meta`. |
| 5 | Waybills tab is now ERP documents | Move any assign/cancel UI to `/officers/loading-requests`. Row key is `docNo`, not `id`. |
| 6 | Nulls everywhere in money | Render `—` for `null`. Never coerce to `0`. |

### Two components you can now share with the distributor app

Strip `lastUpdated` (and `walletBalance` / `paymentHistory` / `customers`) and
these responses are **byte-identical** to the distributor's own:

| Officer route | Distributor route |
|---|---|
| `/officers/customers/{id}/invoices` | `/customers/me/invoices` |
| `/officers/customers/{id}/invoices/{invoiceId}` | `/customers/me/invoices/{id}` |
| `/officers/customers/{id}/stock` | `/customers/me/stock-balance` |
| `/officers/customers/{id}/waybills` | `/customers/me/erp/waybills` |
| `/officers/customers/{id}/waybills/{docNo}` | `/customers/me/erp/waybills/{docNo}` |

That parity is enforced in the backend — one reader serves both — so a
component written against either contract will keep working against the other.

---

## 7. TypeScript types

```ts
export interface Paginated<T> {
  data: T[];
  meta: {
    total: number; page: number; pageSize: number; totalPages: number;
    hasNextPage: boolean; hasPreviousPage: boolean;
  };
}

/** A row of the Invoices tab. */
export interface OrderRow {
  id: string;
  erpId: string;            // the ERP document number — show this
  customerId: string;
  orderDate: string;
  totalItems: number;       // cartons on the order
  totalValue: number;
  status: string;
  statusUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicesTab extends Paginated<OrderRow> {
  lastUpdated: string;
  walletBalance: number;
  paymentHistory: PaymentRow[];
}

/** One merged product line on an order. */
export interface OrderLine {
  product: string;
  itemCode: string | null;
  quantity: number;             // summed across merged lines
  unitPrice: number | null;     // effective rate where parts disagreed
  amount: number | null;        // authoritative; do not recompute
  accountBalance: number;
}

export interface OrderDetail {
  id: string;
  orderId: string;              // the ERP DOC_NO
  orderDate: string;
  status: string;
  statusUpdatedAt: string | null;
  totalItems: number;
  totalValue: number;
  linkedInvoiceNumber: string;
  accountBalance: number;
  lines: OrderLine[];
}

/** One product still to collect. */
export interface StockProduct {
  itemCode: string | null;      // null on ~94% of rows — not a key
  productName: string;
  quantityPaid: number;
  quantityLoaded: number;
  quantityRemaining: number;
  lastOrderDate: string | null; // YYYY-MM-DD
}

export interface StockBalance {
  lastUpdated: string;
  totalPurchasedCartons: number;
  totalLoadedCartons: number;
  totalRemainingCartons: number;
  loadingProgress: number;      // percent
  products: StockProduct[];     // ONLY quantityRemaining > 0
}

/** GET /officers/stock — the same, across the portfolio. */
export interface PortfolioStockBalance extends StockBalance {
  customers: number;
}

/** An ERP goods-movement document. */
export interface ErpWaybill {
  docNo: string;
  docDate: string | null;
  orderDate: string | null;
  shipTo: string | null;
  lines: number;                // ERP line rows rolled into this document
  products: number;
  quantityOrdered: number;
  quantityDelivered: number;
  quantityRemaining: number;
  quantity: number | null;      // ERP QTY_TOTAL — NOT the sum of the items
  totalAmountBeforeTax: number | null;
  taxVat: number | null;
  totalAmountAfterTax: number | null;
  status: string;
  lastChangedAt: string | null;
}

export interface ErpWaybillItem {
  id: string;
  itemCode: string | null;
  description: string | null;
  specification: string | null;
  price: number | null;
  quantity: number;
  quantityDelivered: number;
  quantityRemaining: number;
  totalAmountBeforeTax: number | null;
  taxVat: number | null;
  totalAmountAfterTax: number | null;
  taxRate: number | null;
}

export interface ErpWaybillDetail extends ErpWaybill {
  items: ErpWaybillItem[];      // NOT merged — the ERP document as it stands
}
```

---

## 8. Checklist

- [ ] Invoices tab reads `data` / `meta`, not `invoices`
- [ ] Order rows open the new `…/invoices/{invoiceId}` detail
- [ ] Invoice detail renders `amount` as given — never `quantity × unitPrice`
- [ ] Stock tab rebuilt on totals + `products`; empty `products` shows "nothing outstanding"
- [ ] `/officers/stock` pager removed
- [ ] Waybills tab keyed on `docNo`; assign/cancel moved to `/officers/loading-requests`
- [ ] Every money field renders `—` when `null`
- [ ] `404` on a distributor outside the portfolio handled as "not yours", not as an error
