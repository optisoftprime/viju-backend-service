# Mobile Guide — Invoice / Account route changes + ERP waybills

**For:** Viju distributor mobile app
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` — each route carries these rules in its description

⚠️ **This is a breaking change.** Two paths were swapped, so a build on the old
code will not fail loudly — it will call `/customers/me/invoices` and get a
completely different payload. Plan to ship the app change with the backend
deploy, not after it.

---

## 1. What changed, at a glance

| Old path | New path | What else changed |
|---|---|---|
| `GET /customers/me/purchases` | **`GET /customers/me/invoices`** | already paginated; rows now carry `items` |
| `GET /customers/me/purchases/{id}` | **`GET /customers/me/invoices/{id}`** | `lines` is now populated |
| `GET /customers/me/invoices` | **`GET /customers/me/account`** | now paginated (two lists) |
| `GET /customers/me/invoices/{id}` | **`GET /customers/me/account/{id}`** | `lineItems` is now populated |
| — | **`GET /customers/me/erp/waybills`** | new |

`GET /customers/me/purchases` no longer exists — it returns 404.

**The trap:** `/customers/me/invoices` still exists but means something else now.
It used to be the account aggregate (`walletBalance`, `invoices`,
`paymentHistory`); it is now the paginated order list. An old build hitting it
gets `{ data, meta }` where it expects `walletBalance` — likely a null crash
rather than a clean error.

### Rename checklist

Search the app for these four strings and repoint them:

```
/customers/me/purchases      ->  /customers/me/invoices
/customers/me/purchases/     ->  /customers/me/invoices/
/customers/me/invoices       ->  /customers/me/account        (the aggregate)
/customers/me/invoices/      ->  /customers/me/account/       (invoice detail)
```

Do the `/invoices` -> `/account` replacements **first**, or you will rewrite the
paths you just created.

---

## 2. `GET /customers/me/invoices` — order / invoice list

Was `/customers/me/purchases`. Paginated `{ data, meta }`.

**Query params:** `page`, `pageSize` (clamped to 200, echoed back as applied),
`search` (order id or product name), `startDate`, `endDate` (on the order date).
`meta.total` counts the rows the current filter matches.

```json
{
  "data": [
    {
      "id": "a1ce5c0f-36b3-4930-b4ef-8839e8f1db68",
      "erpId": "2310-202606110033",
      "customerId": "843812d6-fa56-4b36-9095-4f980b6e252c",
      "orderDate": "2026-06-11T00:00:00.000Z",
      "totalItems": 4264,
      "totalValue": 9942000,
      "status": "CLOSED",
      "statusUpdatedAt": null,
      "createdAt": "2026-08-25T08:30:11.981Z",
      "updatedAt": "2026-08-25T08:30:11.981Z",
      "items": [
        {
          "id": "445828",
          "purchaseId": "a1ce5c0f-36b3-4930-b4ef-8839e8f1db68",
          "productName": "Mr V Premium Table Water(Abuja)",
          "itemCode": "0228104d-91d0-4a90-979f-17f31a5be24d",
          "quantity": 1700,
          "unitPrice": null,
          "lineTotal": null
        }
      ]
    }
  ],
  "meta": {
    "total": 4660, "page": 1, "pageSize": 20, "totalPages": 233,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

`items` used to come back empty on almost every order. It is now filled from
the ERP feed — see §6 for why `unitPrice` and `lineTotal` are `null`.

---

## 3. `GET /customers/me/invoices/{id}` — order detail

Was `/customers/me/purchases/{id}`. Shape unchanged; `lines` now has content.

```json
{
  "id": "a1ce5c0f-36b3-4930-b4ef-8839e8f1db68",
  "orderId": "2310-202606110033",
  "orderDate": "2026-06-11T00:00:00.000Z",
  "status": "CLOSED",
  "statusUpdatedAt": null,
  "totalItems": 4264,
  "totalValue": 9942000,
  "linkedInvoiceNumber": "INV-110033",
  "accountBalance": 394073673.14,
  "lines": [
    {
      "product": "Mr V Premium Table Water(Abuja)",
      "itemCode": "0228104d-91d0-4a90-979f-17f31a5be24d",
      "quantity": 1700,
      "unitPrice": null,
      "amount": null,
      "accountBalance": 394073673.14
    }
  ],
  "items": [ "… the same lines in the list-row shape …" ]
}
```

`lines` is the shape to render. `items` is the same data in the list-row shape,
kept so existing bindings keep working. `404` if the order is not this
customer's.

---

## 4. `GET /customers/me/account` — the Account tab aggregate

Was `/customers/me/invoices`. **Now paginated**, and it carries **two** lists.

**Query params:** `page`, `pageSize` — they apply to **both** lists.

```json
{
  "walletBalance": {
    "amount": 33403031.4733,
    "isOverdue": false,
    "lastUpdated": "2026-06-09T08:16:56.533Z"
  },
  "contactNote": "To make a payment, contact your Viju Account Officer.",
  "invoices": [
    {
      "id": "purchase-uuid-1",
      "invoiceNumber": "INV-444120",
      "orderId": "VJ-2026-675",
      "date": "2026-06-01T10:00:00.000Z",
      "totalAmount": 45000,
      "status": "PAID"
    }
  ],
  "meta": {
    "total": 4660, "page": 1, "pageSize": 20, "totalPages": 233,
    "hasNextPage": true, "hasPreviousPage": false
  },
  "paymentHistory": [
    {
      "id": "payment-uuid-1",
      "date": "2026-06-01T10:00:00.000Z",
      "amount": 25000,
      "reference": "TRX-REF-9921",
      "runningBalance": 50000.5
    }
  ],
  "paymentHistoryMeta": {
    "total": 6796, "page": 1, "pageSize": 20, "totalPages": 340,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

### Why there are two meta blocks

The lists are different lengths — one distributor has **4,660 invoices and
6,796 payments**. A single `meta` would describe one correctly and silently
truncate the other at a wrong page count.

- **`meta`** pages `invoices`
- **`paymentHistoryMeta`** pages `paymentHistory`

Read whichever list you are paging. If the two tabs page independently, call the
endpoint twice with different `page` values and take the list you need from
each response.

**Both lists were previously unbounded** — this endpoint used to return 11,456
rows for that customer in one payload. Anything that assumed the full list (a
client-side total, a search across every invoice) must now page, or move to
`GET /customers/me/invoices` and `GET /customers/me/payments`, which are both
paginated in their own right.

`status` on an invoice row is `PAID` | `PART_PAID` | `UNPAID`, derived from the
order lifecycle.

---

## 5. `GET /customers/me/account/{id}` — invoice detail

Was `/customers/me/invoices/{id}`. Shape unchanged; `lineItems` now has content.

```json
{
  "id": "a1ce5c0f-36b3-4930-b4ef-8839e8f1db68",
  "invoiceNumber": "INV-110033",
  "orderId": "2310-202606110033",
  "date": "2026-06-11T00:00:00.000Z",
  "status": "PAID",
  "lineItems": [
    {
      "id": "445828",
      "productName": "Mr V Premium Table Water(Abuja)",
      "itemCode": "0228104d-91d0-4a90-979f-17f31a5be24d",
      "quantity": 1700,
      "unitPrice": null,
      "lineTotal": null
    }
  ],
  "subtotal": 9942000,
  "tax": 0,
  "grandTotal": 9942000
}
```

`subtotal` / `grandTotal` are the **order total the ERP states** — real money,
safe to display. `404` if the invoice is not this customer's.

---

## 6. ⚠️ `unitPrice` and `lineTotal` are now nullable

Read this before wiring the line-item screens.

These fields are typed `number` in the old contract and are now **`number | null`**.
Unwrapping them unconditionally will crash.

**Why.** Line items used to be empty on 10,320 of 10,350 orders, because the
ingest projector does not copy them. They are now read live from the ERP
sales-order feed, which states **product, item code and quantity per line — but
no per-line money**. The amount field on the feed is the ORDER total repeated on
every line: on one 3-product order, yoghurt and water both read `258,000`.

Apportioning that across lines would invent prices that look authoritative and
disagree with the ERP, so the fields are `null` instead.

**What to render:** product name and quantity per line; take the money from the
order-level `totalValue` (order detail) or `grandTotal` (invoice detail). Hide
the price column, or show `—`, when `unitPrice` is null.

```dart
// Dart / Flutter
final unitPrice = line['unitPrice'] as num?;   // nullable
final priceLabel = unitPrice == null ? '—' : formatMoney(unitPrice);
```

```ts
// TypeScript
interface LineItem {
  id: string;
  productName: string;
  itemCode: string | null;
  quantity: number;
  unitPrice: number | null;   // was number
  lineTotal: number | null;   // was number
}
```

If per-line pricing matters more than accuracy, we can apportion the order total
by quantity instead — tell the backend team and it is a small change. It would
be an estimate, not the ERP's figure.

---

## 7. `GET /customers/me/erp/waybills` — new

The ERP's own goods-movement records. **A different resource from
`GET /customers/me/waybills`**, which is unchanged and still lists the loading
requests the distributor raised through this app.

| | `/customers/me/waybills` | `/customers/me/erp/waybills` |
|---|---|---|
| Source | loading requests raised in this app | the ERP sales-order feed |
| Covers | only what went through the portal | everything the ERP holds |
| Identifier | `reference` (`WB-123456`) | `docNo` (`2310-202606110033`) |
| Has truck / driver | yes | no |

Neither is a filter of the other. If the screen is "my loading requests", keep
the existing route; if it is "everything the ERP has moved for me", use this one.

**Query params:** `page`, `pageSize` (clamped to 200).

```json
{
  "data": [
    {
      "docNo": "2310-202606110033",
      "docDate": "2026-06-11 00:00:00",
      "orderDate": "2026-06-11 00:00:00",
      "shipTo": "Lagos Depot",
      "lines": 4,
      "products": 1,
      "quantityOrdered": 4264,
      "quantityDelivered": 4264,
      "quantityRemaining": 0,
      "status": "CLOSED",
      "lastChangedAt": "2026-08-28T12:49:31.019Z"
    },
    {
      "docNo": "2310-202606090083",
      "orderDate": "2026-06-09 00:00:00",
      "lines": 4,
      "products": 1,
      "quantityOrdered": 4680,
      "quantityDelivered": 4368,
      "quantityRemaining": 312,
      "status": "PROCESSING",
      "lastChangedAt": "2026-08-28T12:49:31.019Z"
    }
  ],
  "meta": {
    "total": 4672, "page": 1, "pageSize": 20, "totalPages": 234,
    "hasNextPage": true, "hasPreviousPage": false
  }
}
```

Notes for rendering:

- **One row per ERP document.** The feed is one row per order *line*; rows are
  rolled up to one per `docNo`, which is what a waybill is. `lines` says how
  many line rows it collapsed, `products` how many distinct products.
- `status` is `PENDING` | `PROCESSING` | `DELIVERED` | `CLOSED`, derived with the
  same rules as the order list, so a document cannot show one status here and a
  different one there.
- `docDate` / `orderDate` are the ERP's own **strings**, not ISO-8601 — parse
  `"2026-06-11 00:00:00"` accordingly, or display as-is.
- `quantityRemaining` is `ordered - delivered`, floored at 0.
- An absent ERP feed or an unknown customer returns an **empty page with a valid
  `meta`**, never an error — render the empty state.
- Volume is high (4,672 documents for one distributor) and the query is heavier
  than the other list endpoints. Page it; do not prefetch it all.

---

## 8. Suggested order of work

1. Do the four path renames (§1), `/invoices` → `/account` **first**.
2. Make `unitPrice` / `lineTotal` nullable in the models (§6) — this is the one
   that crashes rather than merely misbehaves.
3. Page the Account tab (§4): wire `meta` to the invoice list and
   `paymentHistoryMeta` to payments, and drop any full-list assumptions.
4. Render line items on both detail screens — quantity and product, money from
   the order-level total.
5. Add the ERP waybills screen (§7) if it is in scope; it is purely additive.

## 9. Also changed in this release

Not part of the five endpoints above, but customer-facing and worth checking:

- **Account officers are now named to distributors.** `senderLabel` on
  `GET /chat/me` was the closed set `'Viju Account Officer' | 'You'` and is now
  **free text** — the officer's real name, or `'You'`. If it is typed as an enum
  or switched on, it needs to change. `GET /customers/me` →
  `accountOfficer.displayName` is likewise the officer's real name now, and the
  object gained an `id`.
- **`GET /customers/me/chats`** is new: the distributor's account officers as a
  chat list, so they can pick who to message. Pass a row's `officerId` to
  `GET /chat/{officerId}` and `POST /chat/{officerId}`.
- **`GET /customers/me/home`** gained `temporarilyCredit` — supplementary ERP
  credit in force today, or `0`. **Do not add it to `accountBalance.amount`**;
  the balance already includes that figure and summing them double-counts.
- **Stock balance** on `/customers/me/home` and `/customers/me/stock-balance`
  now comes from the ERP and the two agree. The numbers will jump — that is the
  fix, not a bug.

## 10. Questions

Anything ambiguous here is worth asking rather than guessing — particularly the
nullable money in §6 and the two meta blocks in §4, both of which were backend
judgement calls that can be changed if they do not suit the screens.
