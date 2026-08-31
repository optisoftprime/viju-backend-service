# Mobile Guide — Raising a Loading Request

**For:** the Viju distributor (customer) mobile app
**Endpoint:** `POST /api/v1/customers/me/waybills`
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` → *Customer Portal* — every rule here is also on the route

A distributor books a truck against **one or more sales orders**, says what is
going on it, and submits. Four API calls.

Every example in this document was run against live data (distributor
`LATLEK`, orders `2300-202606110059` and `2300-202606110027`) and the responses
are copied verbatim.

---

## 1. The flow at a glance

| # | Call | Purpose |
|---|---|---|
| 1 | `POST /customers/me/waybills/accept-terms` | Record T&C acceptance. **Valid 1 hour.** |
| 2 | `GET /customers/me/invoices` | List the distributor's ORDERS. Pick **one or more**. |
| 3 | `GET /erp/orders/{orderId}/products` | The products on one order, with carton weights. Call once **per order picked**. |
| 4 | `POST /customers/me/waybills` | Submit — the orders, their products, the truck and the driver. |

Then `GET /customers/me/waybills` (list) and `GET /customers/me/waybills/{id}`
(detail) to show it afterwards.

> ### ⚠️ Step 2 is `/invoices`, not `/waybills`
>
> `GET /customers/me/waybills` lists **loading requests already raised** — it is
> the *history* screen, not the order picker. The orders available to load are
> on `GET /customers/me/invoices` (3,827 rows for LATLEK). Take the row's `id`.

---

## 2. Step 1 — accept the terms

```http
POST /api/v1/customers/me/waybills/accept-terms
Authorization: Bearer <customer JWT>
Content-Type: application/json

{ "termsVersion": "viju-tnc-v1" }
```

`termsVersion` is **required** and must be a non-empty string — send the
identifier of the T&C text you displayed.

```json
{
  "formUrl": "https://forms.example.com/viju-loading",
  "acceptedAt": "2026-08-31T10:51:23.737Z",
  "note": "Open this URL in a browser / in-app web view. …"
}
```

Acceptance lasts **one hour**. Submitting without a recent one is refused:

```json
{ "message": "You must accept the Viju Terms & Conditions before submitting a loading request.",
  "error": "Forbidden", "statusCode": 403 }
```

**Practical rule:** if the distributor has been filling the form for a while,
call this again right before submitting rather than letting them hit the 403.

---

## 3. Step 2 — pick the orders

```http
GET /api/v1/customers/me/invoices?page=1&pageSize=20
```

Paginated `{ data, meta }`. Also accepts `search` and `startDate` / `endDate`.
Pagination params are `page` and **`pageSize`** (not `limit`); `pageSize` above
200 is clamped, and `meta.pageSize` reports what was applied.

```json
{
  "data": [
    {
      "id": "f7a86c0a-1ee9-40d0-85a0-5334f6da100c",
      "erpId": "2300-202606110059",
      "orderDate": "2026-06-11T00:00:00.000Z",
      "totalItems": 2860,
      "totalValue": 4084000,
      "status": "CLOSED",
      "items": [ /* order lines */ ]
    }
  ],
  "meta": { "total": 3827, "page": 1, "pageSize": 20, "totalPages": 192,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

| Field | Use |
|---|---|
| `id` | the uuid to carry into steps 3 and 4 |
| `erpId` | the ERP document number, e.g. `2300-202606110059` — **show this** |

Show `erpId` to the distributor: that is the number they and the depot both
recognise. Keep `id` for the API calls.

**This screen should allow multiple selection.** A truck is rarely filled from a
single sales order, and the submit endpoint takes as many as the distributor
picks.

---

## 4. Step 3 — the products on each order

Call once per selected order:

```http
GET /api/v1/erp/orders/f7a86c0a-1ee9-40d0-85a0-5334f6da100c/products
```

Either identifier works — the `id` uuid **or** the `erpId` DOC_NO. The response
is a **bare array** (no `data` wrapper), one entry per distinct product:

```json
[
  { "productId": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
    "weightPerCarton": 9.38, "matchedOn": "SPEC_AND_NAME" },
  { "productId": "101060111", "productName": "V-COOL COFFEE(Abuja)",
    "weightPerCarton": 6.33, "matchedOn": "SPEC_AND_NAME" },
  { "productId": "101060115", "productName": "V-COOL GOLDEN KOLA(Abuja)",
    "weightPerCarton": 6.33, "matchedOn": "SPEC_AND_NAME" }
]
```

The ERP feed holds one row per order *line*, so several lines of the same
product collapse into one entry here.

**A distributor only sees their own orders.** Another distributor's order id
returns `[]`, as does an unknown one — never an error. Render the empty state,
not a failure.

### `productId` and `weightPerCarton` can be null

`matchedOn` tells you how the product was matched to the Viju specification
sheet:

| `matchedOn` | Meaning |
|---|---|
| `SPEC_AND_NAME` | matched on size + name — the strongest match |
| `NAME` | the name is unambiguous in the sheet |
| `SPEC` | the size identified the weight; the exact name was not in the sheet. The weight is still reliable |
| `NONE` | **not in the sheet** — `productId` and `weightPerCarton` are both `null` |

18.9L water and the cracker lines are absent from the sheet today, so `NONE` is
a real case, not an error.

- **Do not block a `NONE` product from being loaded.** Show it, take a quantity,
  send it back with the nulls.
- **Do not compute a total weight from a null.** Check first, or render `—`.

---

## 5. Step 4 — what the distributor fills in

Per product on each order: a **quantity in cartons**.

For the request as a whole:

| Field | Notes |
|---|---|
| `warehouseName` | one of `LAGOS WAREHOUSE`, `OGUN WAREHOUSE`, `ABUJA WAREHOUSE` — exact strings, spaces included |
| `truckPlateNumber` | free text |
| `driverName` | free text |
| `driverPhone` | free text |
| `loadingCapacity` | the **truck's** carton capacity — *not* the size of this load |
| `requestedLoadingDate` | `YYYY-MM-DD` |
| `destination` | optional free text |

Drop any product left at zero rather than sending `quantity: 0` — the minimum
is 1 and a zero is rejected.

---

## 6. Step 5 — submit

```http
POST /api/v1/customers/me/waybills
Authorization: Bearer <customer JWT>
Content-Type: application/json
```

```json
{
  "warehouseName": "LAGOS WAREHOUSE",
  "truckPlateNumber": "LAG-234-XY",
  "driverName": "Jimoh Ibrahim",
  "driverPhone": "+2348012345678",
  "loadingCapacity": 1200,
  "orders": {
    "f7a86c0a-1ee9-40d0-85a0-5334f6da100c": [
      { "productId": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
        "quantity": 120, "weightPerCarton": 9.38 },
      { "productId": "101060111", "productName": "V-COOL COFFEE(Abuja)",
        "quantity": 80, "weightPerCarton": 6.33 }
    ],
    "ea95bb9e-e470-4743-ab20-618841ea9abf": [
      { "productId": "101011701", "productName": "VSMARTIC WHEAT FLAVOURED MILK",
        "quantity": 10, "weightPerCarton": 11.6 }
    ]
  },
  "linkedPurchaseId": [
    "f7a86c0a-1ee9-40d0-85a0-5334f6da100c",
    "ea95bb9e-e470-4743-ab20-618841ea9abf"
  ],
  "requestedLoadingDate": "2026-09-05"
}
```

### 6.1 `orders` — the load, grouped by order

`orders` is an **object keyed by order**, not an array. Each key is one order
being drawn from; the value is the lines taken from it. Run the step-3 picker
once per selected order and merge the results into this one object.

A key is **either** the `id` uuid from step 2 **or** the ERP `DOC_NO` — both
resolve to the same order, so send whichever the screen already holds.

Per line: `productName` and `quantity` are **required**; `productId` and
`weightPerCarton` are optional and may be `null`. **200 lines maximum across
all orders.**

### 6.2 `linkedPurchaseId` — the orders the request is filed against

Send the **array** of every order in `orders`:

```json
"linkedPurchaseId": ["f7a86c0a-…", "ea95bb9e-…"]
```

- **The first entry is the primary order.** The request is filed under it and
  its DOC_NO becomes the request's `reference`. Put the order the distributor
  chose first at the front.
- Entries may be uuids or DOC_NOs, mixed.
- Duplicates are collapsed.
- **Every entry must also be a key of `orders`.** An order the request names but
  loads nothing from would be silently lost, so it is a `400` instead.
- A bare string (`"linkedPurchaseId": "f7a86c0a-…"`) is still accepted for the
  one-order case and behaves exactly as before.

### 6.3 Two things that will bite

**1. `productId` is a string.** The products endpoint returns `"101020104"`;
echo it back verbatim. A raw number is coerced rather than rejected, so
`101020104` also works — but an ERP code that ever gains a leading zero would
lose it as a number. Quote it.

**2. Do not send `quantityCartons` yourself.** When any lines are present the
backend **derives** it as the sum of the quantities **across every order** and
ignores whatever you send. Above: `120 + 80 + 10 = 210`.

This is deliberate. Every stock figure in the system reads `quantityCartons` on
completed loads, so it has to agree with the lines rather than sit beside them.
Sending `320` against lines summing to `210` would quietly corrupt the
distributor's stock balance.

`loadingCapacity` (1200) is the **truck**; `quantityCartons` (210) is the
**load**. Different numbers, both kept.

### 6.4 Field reference

| Field | Required | Notes |
|---|---|---|
| `linkedPurchaseId` | **yes** | order id, or array of order ids; first = primary |
| `truckPlateNumber` | **yes** | |
| `driverName` | **yes** | |
| `driverPhone` | **yes** | |
| `requestedLoadingDate` | **yes** | `YYYY-MM-DD` |
| `orders` | no | `{ "<order id or DOC_NO>": [ lines ] }`, ≤ 200 lines total |
| `products[]` | no | single-order form; superseded by `orders` |
| `warehouseName` | no | the three exact strings; anything else is a `400` |
| `loadingCapacity` | no | the truck's capacity |
| `destination` | no | free text |
| `quantityCartons` | no | **ignored when any lines are sent** — see 6.3 |

`products[]` (a flat array, all attributed to `linkedPurchaseId`) still works
for a single-order load. If a body sends both, **`orders` wins.** New screens
should send `orders`.

---

## 7. Response — `201`

```json
{
  "id": "867df5a4-671b-4ed5-bb17-10f19b84f7f0",
  "reference": "2300-202606110059",
  "customerId": "2e5d0e84-0d8e-4685-911d-ca2a4c2420b8",
  "region": "WESTERN",
  "linkedPurchaseId": "f7a86c0a-1ee9-40d0-85a0-5334f6da100c",
  "linkedPurchaseIds": [
    "f7a86c0a-1ee9-40d0-85a0-5334f6da100c",
    "ea95bb9e-e470-4743-ab20-618841ea9abf"
  ],
  "warehouseName": "LAGOS WAREHOUSE",
  "truckPlateNumber": "LAG-234-XY",
  "driverName": "Jimoh Ibrahim",
  "driverPhone": "+2348012345678",
  "requestedLoadingDate": "2026-09-05T00:00:00.000Z",
  "loadingCapacity": 1200,
  "quantityCartons": 210,
  "destination": null,
  "status": "PENDING_ASSIGNMENT",
  "products": [
    { "id": "b5f2da5f-…", "purchaseId": "f7a86c0a-…", "orderReference": "2300-202606110059",
      "productId": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
      "quantity": 120, "weightPerCarton": 9.38 },
    { "id": "34985535-…", "purchaseId": "f7a86c0a-…", "orderReference": "2300-202606110059",
      "productId": "101060111", "productName": "V-COOL COFFEE(Abuja)",
      "quantity": 80, "weightPerCarton": 6.33 },
    { "id": "da1c4583-…", "purchaseId": "ea95bb9e-…", "orderReference": "2300-202606110027",
      "productId": "101011701", "productName": "VSMARTIC WHEAT FLAVOURED MILK",
      "quantity": 10, "weightPerCarton": 11.6 }
  ],
  "termsAcceptedAt": "2026-08-31T10:51:23.347Z",
  "createdAt": "2026-08-31T10:51:25.115Z"
}
```

### The lines come back FLAT, not as the map you sent

Each line carries `purchaseId` (the order's uuid) and `orderReference` (its
DOC_NO). Group on one of those to rebuild the per-order view:

```ts
const byOrder = groupBy(res.products, (p) => p.orderReference);
```

Both are `null` on requests raised before multi-order support — render those
under the request's own `linkedPurchaseId`.

### `linkedPurchaseId` vs `linkedPurchaseIds`

| Field | What it is |
|---|---|
| `linkedPurchaseId` | the **primary** order (a single uuid) — what `reference` came from |
| `linkedPurchaseIds` | **every** order on the load, primary first |

Show `linkedPurchaseIds` when listing the orders on a request.

### `reference` is the ERP document number

`reference` is the DOC_NO of the primary order — the same value as
`linkedPurchase.erpId`. Show it to the distributor; the depot recognises it.

**One order can be loaded in parts.** The second load of the same order gets a
suffix: `2300-202606110059-02`, `-03`, and so on. Treat `reference` as an
opaque string — do not parse it.

The regional admin for the distributor's region is notified automatically, and
the request starts at `PENDING_ASSIGNMENT`.

---

## 8. Errors

| Status | Message / cause |
|---|---|
| `401` | missing, invalid or expired token |
| `403` | `"You must accept the Viju Terms & Conditions before submitting a loading request."` — T&C missing or older than an hour |
| `400` | `"Linked order not found or does not belong to this customer."` — bad single-string `linkedPurchaseId` |
| `400` | `"Linked order \"…\" was not found or does not belong to this customer."` — a bad entry in the `linkedPurchaseId` array |
| `400` | `"Order \"…\" was not found or does not belong to this customer."` — a bad key in `orders` |
| `400` | `"Order \"…\" is listed in linkedPurchaseId but has no products in \`orders\`."` |
| `400` | `"orders[\"…\"] must be an array of products."` |
| `400` | `"orders[\"…\"] contains a line without a productName or quantity."` |
| `400` | `"orders[\"…\"] contains a line with a quantity below 1."` |
| `400` | `"A loading request cannot carry more than 200 product lines."` |
| `400` | `"warehouseName must be one of: LAGOS WAREHOUSE, OGUN WAREHOUSE, ABUJA WAREHOUSE"` |
| `400` | class-validator array — missing required field, unknown property, `quantity` below 1 |

**Nothing is written when a request is rejected.** Every check runs before the
row is created, so a `400` is safe to fix and resend — no partial loading
request is left behind.

Two of these are worth special handling in the UI:

- **`403` on terms** — re-call `accept-terms` silently and retry once, rather
  than showing the distributor an error they cannot act on.
- **`"…is listed in linkedPurchaseId but has no products…"`** — this means the
  distributor selected an order in step 2 and then entered no quantities for it.
  Either drop the order from `linkedPurchaseId` or send it back to the quantity
  screen. Do not surface the raw message.

---

## 9. Afterwards — the history screens

```http
GET /api/v1/customers/me/waybills?page=1&pageSize=20     # the list
GET /api/v1/customers/me/waybills/{id}                   # one request
```

Both return `linkedPurchaseIds`, `products`, `warehouseName` and
`loadingCapacity` alongside the existing fields. `products` is `[]` on requests
raised without a breakdown.

The list is `{ data, meta }`, newest first. Detail additionally returns
`linkedPurchase { id, erpId }` (the primary order) and `assignedOfficer`.

### Status lifecycle

```
PENDING_ASSIGNMENT → ASSIGNED → LOADING_IN_PROGRESS → COMPLETED
                                                    ↘ CANCELLED
```

Driven by the regional admin and the loading officer — the distributor app is
read-only after submitting.

### The loading officer is never named to the distributor

`assignedOfficer` is `null` until one is assigned, then:

```json
"assignedOfficer": { "displayName": "Viju Loading Officer" }
```

That generic label is deliberate (PRD F6) — **loading** officers are never named
to customers. Do not try to source a real name from elsewhere. (This is
different from the *account* officer, who **is** named on the chat screens.)

---

## 10. TypeScript types

```ts
/** A row from GET /erp/orders/{orderId}/products. */
export interface ErpOrderProduct {
  productId: string | null;
  productName: string;
  weightPerCarton: number | null;
  matchedOn: 'SPEC_AND_NAME' | 'NAME' | 'SPEC' | 'NONE';
}

/** One line the distributor is loading. */
export interface LoadingRequestProduct {
  productId?: string | null;
  productName: string;
  quantity: number;              // >= 1
  weightPerCarton?: number | null;
}

export type WarehouseName =
  | 'LAGOS WAREHOUSE'
  | 'OGUN WAREHOUSE'
  | 'ABUJA WAREHOUSE';

export interface SubmitLoadingRequest {
  /** Order id, or the list of them. First = primary. */
  linkedPurchaseId: string | string[];
  truckPlateNumber: string;
  driverName: string;
  driverPhone: string;
  requestedLoadingDate: string;  // YYYY-MM-DD
  /** Lines keyed by order id or DOC_NO. Preferred over `products`. */
  orders?: Record<string, LoadingRequestProduct[]>;
  /** Single-order form; attributed to `linkedPurchaseId`. */
  products?: LoadingRequestProduct[];
  warehouseName?: WarehouseName;
  loadingCapacity?: number;
  destination?: string;
  // quantityCartons is deliberately absent: it is derived from the lines.
}

export interface LoadingRequestLine extends LoadingRequestProduct {
  id: string;
  purchaseId: string | null;     // which order this line came from
  orderReference: string | null; // that order's DOC_NO
}

export type LoadingRequestStatus =
  | 'PENDING_ASSIGNMENT'
  | 'ASSIGNED'
  | 'LOADING_IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface LoadingRequest {
  id: string;
  reference: string;             // ERP DOC_NO, possibly with a -02 suffix
  linkedPurchaseId: string | null;   // primary order
  linkedPurchaseIds: string[];       // every order on the load
  truckPlateNumber: string;
  driverName: string;
  driverPhone: string;
  requestedLoadingDate: string;
  quantityCartons: number | null;    // derived: sum of all line quantities
  loadingCapacity: number | null;    // the truck
  warehouseName: WarehouseName | null;
  destination: string | null;
  status: LoadingRequestStatus;
  products: LoadingRequestLine[];
  createdAt: string;
}
```

---

## 11. Building the body — worked example

```ts
// State the picker screens produce.
const selectedOrders: { id: string; erpId: string }[] = [...];
const quantities: Record<string /* orderId */, Record<string /* productName */, number>> = {...};
const catalogue: Record<string /* orderId */, ErpOrderProduct[]> = {...};

const orders: Record<string, LoadingRequestProduct[]> = {};
for (const order of selectedOrders) {
  const lines = (catalogue[order.id] ?? [])
    .map((p) => ({
      productId: p.productId,               // string | null, echoed as returned
      productName: p.productName,
      quantity: quantities[order.id]?.[p.productName] ?? 0,
      weightPerCarton: p.weightPerCarton,   // number | null, echoed as returned
    }))
    .filter((l) => l.quantity > 0);         // never send a zero

  // An order with nothing on it must not be named at all.
  if (lines.length > 0) orders[order.id] = lines;
}

const body: SubmitLoadingRequest = {
  warehouseName,
  truckPlateNumber,
  driverName,
  driverPhone,
  loadingCapacity,
  orders,
  linkedPurchaseId: Object.keys(orders),    // first entry = primary
  requestedLoadingDate,                     // 'YYYY-MM-DD'
};

if (Object.keys(orders).length === 0) {
  // Nothing selected — block locally, do not call the API.
}
```

Deriving `linkedPurchaseId` from `Object.keys(orders)` makes the
"listed but no products" `400` structurally impossible.

---

## 12. Checklist

- [ ] `accept-terms` called within the last hour of submitting
- [ ] Order picker is **multi-select**, sourced from `/customers/me/invoices`
- [ ] Products fetched per selected order from `/erp/orders/{id}/products`
- [ ] `matchedOn: "NONE"` products still loadable; no arithmetic on `null`
- [ ] Zero-quantity lines dropped, not sent
- [ ] `orders` keyed by order id; `linkedPurchaseId` is the array of those keys
- [ ] `quantityCartons` **not** sent
- [ ] `productId` sent as a **string**
- [ ] `warehouseName` is one of the three exact strings
- [ ] Response lines grouped back by `orderReference` for display
- [ ] `reference` shown to the distributor, treated as opaque
- [ ] Loading officer shown as `"Viju Loading Officer"`, never a name
