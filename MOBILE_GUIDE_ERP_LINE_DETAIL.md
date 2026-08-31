# Mobile Guide — ERP line detail, waybill items & financial ledgers

**Base URL:** every path is prefixed with `/api/v1`
**Swagger:** `/api/docs` → *Customer Portal*
**Branch:** `dev`

Five changes, all on the distributor-facing surface. Sections 1–3 change
existing responses; 4–5 are new endpoints.

---

## ⚠️ Read this first: most ERP money is NULL

The ERP populates per-line `ITEM_CODE`, `PRICE`, `AMOUNT` and `TAX_RATE` on
**56,766 of 993,979 line rows — 5.7%**. The gaps are spread evenly across
2018–2026, so this is not "old data is thin, new data is complete".

Everything below returns **`null`, never `0`**, where the ERP states nothing.
That distinction is deliberate and load-bearing:

* `null` → the ERP did not say. Render a dash, `—`, or hide the row.
* `0` → the ERP said zero. A real, quoted zero.

Please do not `?? 0` these fields. A silent line rendered as ₦0.00 reads as
"this cost nothing", which is a different and wrong claim.

---

## 1. `GET /customers/me/stock-balance`

**Fully collected products are gone from `products`.** Only rows with
`quantityRemaining > 0` are returned — a product the distributor has taken in
full is not part of a stock balance.

**`products` no longer sums to the totals.** The totals still describe the
whole order history, so a distributor who has collected everything gets:

```json
{
  "totalPurchasedCartons": 700,
  "totalLoadedCartons": 700,
  "totalRemainingCartons": 0,
  "loadingProgress": 100,
  "products": []
}
```

An empty `products` with non-zero totals is the **normal, correct** state for a
distributor holding no stock. Render "nothing awaiting collection", not "no
purchase history".

**Each product gains `itemCode`** (ERP `ITEM_CODE`), null where the feed
carries none:

```json
{
  "itemCode": "101020104",
  "productName": "Viju Chivita 1L",
  "quantityPaid": 100,
  "quantityLoaded": 60,
  "quantityRemaining": 40
}
```

---

## 2. `GET /customers/me/invoices` and `/invoices/{id}`

The `lines[]` (and `items[]`) entries now carry real values where they
previously carried nulls or a wrong id.

| Field | Source | Note |
|---|---|---|
| `itemCode` | `ITEM_CODE` | **Was a GUID.** See below. |
| `unitPrice` | `PRICE` | Was hard-coded `null`. |
| `amount` / `lineTotal` | `AMOUNT` | Was hard-coded `null`. |

> ⚠️ **`itemCode` values change shape.** It was being read from `ITEM_ID`,
> which is a GUID (`218137e0-e453-41fa-c378-14c55f840acd`), not a code. It is
> now `ITEM_CODE` (`101010317`) — the same code the product specification
> sheet uses. If anything stored, matched on, or displayed the old value, it
> needs updating.

Verified against order `2300-201808010026`: line 2 reads `PRICE` 1150 against
quantity 200 for `AMOUNT` 230,000 — genuinely per-line, not the order total
repeated. (An earlier note in the codebase claimed the feed had no per-line
money; it was looking at `AMT_UNINCLUDE_TAX_OC`, which *is* the order total
repeated, and at `PRICE_QTY1`, which mirrors quantity.)

---

## 3. `GET /customers/me/erp/waybills` — four new fields

The list still returns **one row per ERP document (`DOC_NO`)**. Four money and
quantity fields are added:

| Field | Source | How it is derived |
|---|---|---|
| `quantity` | `QTY_TOTAL` | Taken **once**, not summed |
| `totalAmountBeforeTax` | `AMOUNT` | **Sum** of the document's lines |
| `taxVat` | `AMOUNT × TAX_RATE` | Computed **per line**, then summed |
| `totalAmountAfterTax` | — | `totalAmountBeforeTax + taxVat` |

Two things worth knowing about how these are computed:

**`quantity` is not the sum of the items.** `QTY_TOTAL` is a document-level
figure the ERP repeats on every line — verified constant within all 292,886
documents. Summing it would multiply it by the line count (202 would read 808
on a four-line document). If you need per-item quantities, they are on the
detail endpoint as `BUSINESS_QTY`.

**Tax is computed per line, then summed** — not by applying one rate to the
document total — because `TAX_RATE` can differ line to line. It is already a
decimal fraction in the feed: `0.075` means 7.5%, so `100 × 0.075 = 7.5` and
`totalAmountAfterTax` is `107.5`, exactly as specified.

**`description`, `specification` and `price` are NOT on the list.** 96.5% of
documents carry more than one item (average 3.4, maximum 42), so they cannot
be single values on a document row. They are per-item, on §4.

---

## 4. `GET /customers/me/erp/waybills/{docNo}` — NEW

The detail behind a list row. Same document shape, plus `items[]`:

```json
{
  "docNo": "2300-201808010026",
  "docDate": "2018-08-01 00:00:00",
  "lines": 4,
  "products": 2,
  "quantity": 202,
  "totalAmountBeforeTax": 230000,
  "taxVat": 0,
  "totalAmountAfterTax": 230000,
  "status": "DELIVERED",
  "items": [
    {
      "id": "9f1c…",
      "itemCode": "101010317",
      "description": "viju apple bbstar milk(25)O",
      "specification": "210ML(O)",
      "price": 1150,
      "quantity": 200,
      "quantityDelivered": 200,
      "quantityRemaining": 0,
      "totalAmountBeforeTax": 230000,
      "taxVat": 0,
      "totalAmountAfterTax": 230000,
      "taxRate": 0
    }
  ]
}
```

**`specification` has the Chinese stripped.** The ERP writes a Latin size and a
Chinese product category together — `210ML果味(O)` — and the category is
already carried in English by `description`. So `210ML果味(O)` → `210ML(O)`,
`500ML果汁(O)` → `500ML(O)`, `100ML中性` → `100ML`. A value that was entirely
Chinese comes back `null` rather than as an empty string.

**Item `quantity` is `BUSINESS_QTY`** — that line's own quantity — unlike the
document-level `quantity` on the parent. They are different numbers and both
are correct.

`404` for an unknown document **and** for one belonging to another
distributor — deliberately indistinguishable, so a `docNo` cannot be probed.

---

## 5. ERP financial ledgers — NEW

Six endpoints, three ledgers:

| Endpoint | ERP table | What it holds |
|---|---|---|
| `GET /customers/me/erp/refund` | `raw_ar_refund` | AR refunds |
| `GET /customers/me/erp/refund/{id}` | | one refund |
| `GET /customers/me/erp/collection` | `raw_collection` | money received |
| `GET /customers/me/erp/collection/{id}` | | one collection |
| `GET /customers/me/erp/receivable` | `raw_other_receivable` | other receivables |
| `GET /customers/me/erp/receivable/{id}` | | one receivable |

`{id}` is the ERP document number (`DOC_NO`), e.g. `6301-202606080107` — the
same value the list returns as `docNo`.

The three list endpoints take the standard `page` / `pageSize` (clamped to 200,
echoed back as applied) and return the usual `{ data, meta }`, newest first.
All six are scoped to the signed-in distributor by `CUSTOMER_CODE`: a document
belonging to another customer answers **404**, exactly as a nonexistent one
does, so a document number cannot be probed.

An absent ERP feed or an unknown customer gives an empty page with a valid
`meta` — never an error.

### Response shape

All three ledgers share one document shape; only the keys inside `amounts`
differ.

```json
{
  "docNo": "6301-202606080107",
  "docDate": "2026-06-08 00:00:00",
  "bookkeepingDate": "2026-06-08 00:00:00",
  "customerCode": "51310004",
  "customerName": "…",
  "approveStatus": "Y",
  "approveDate": "2026-06-08 10:14:00",
  "remark": null,
  "exchangeRate": 1,
  "amounts": {
    "collectionAmount": { "fc": 17630000, "tc": 17630000 },
    "cashDiscountAmount": { "fc": 0, "tc": 0 }
  },
  "lastChangedAt": "2026-06-08T11:02:00.000Z"
}
```

### `amounts` keys, per ledger

Read them **by name**, never by position — the sets differ:

| Endpoint | Keys in `amounts` |
|---|---|
| `/erp/refund` | `refundAmount`, `receivablesAmount`, `arVerificationAmount`, `advanceReceiptVerifiedAmount`, `cashDiscountAmount`, `additionalExpenseAmount`, `gainAmount`, `lossAmount` |
| `/erp/collection` | `collectionAmount`, `cashDiscountAmount`, `additionalExpenseAmount`, `settlementExpenseAmount`, `gainAmount` |
| `/erp/receivable` | `amount`, `receivableAmount`, `additionalExpenseAmount` |

### Why every amount has `fc` and `tc`

The ERP states most figures twice — foreign currency (`_FC`) and transaction
currency (`_TC`). Both are returned rather than picking one, because which is
meaningful depends on the currency the document was raised in, and choosing
here would be a guess. `exchangeRate` sits alongside so you can reconcile them.

On the Nigerian data seen so far the two are equal with `exchangeRate: 1` — but
please don't hard-code that assumption.

Both are `null` where the ERP states none. Same rule as everywhere else in this
guide: **null means "not stated", not zero.**

### Volumes

Across all customers: 497,320 collections, 5,763 other receivables, 530
refunds. A single distributor sees a small slice — the busiest collections
customer has 827 documents, and most refund customers have exactly one.

---

## Summary of breaking changes

| Endpoint | Change | Action |
|---|---|---|
| `/customers/me/stock-balance` | `products` excludes `quantityRemaining === 0` | Handle an empty array with non-zero totals |
| `/customers/me/invoices*` | `itemCode` is now a code, not a GUID | Update anything storing or matching it |
| `/customers/me/invoices*` | `unitPrice` / `amount` now populated | They were always `null` — render `null` as `—`, not `0` |

Everything else is additive.
