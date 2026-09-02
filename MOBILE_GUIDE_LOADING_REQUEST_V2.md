# Mobile Guide — Loading Requests (v2)

**For:** the Viju distributor mobile app
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` → *Customer Portal*

Four endpoints, and **all four changed**. This supersedes
`MOBILE_GUIDE_LOADING_REQUEST.md`.

| Endpoint | Purpose |
|---|---|
| `GET /erp/orders/{orderId}/products` | the products on an order, with weights |
| `POST /customers/me/waybills` | create |
| `PATCH /customers/me/waybills/{id}` | **new** — edit |
| `GET /customers/me/waybills` | list |
| `GET /customers/me/waybills/{id}` | detail |

Every example was captured from live data.

> ### ⚠️ Read §7 before you ship
> Three changes reject bodies the current app sends. They are not
> backward-compatible, and the app has to go out with the backend.

---

## 1. Products on an order

```http
GET /api/v1/erp/orders/{orderId}/products
Authorization: Bearer <customer JWT>
```

`orderId` is the `id` from `GET /customers/me/invoices`, or the ERP `DOC_NO`.

```json
[
  { "productId": "101020104",
    "productName": "Mr V Premium Table Water(Lagos)",
    "spec": "100ML",
    "weightPerCarton": 2.7,
    "quantityLeft": 100 },
  { "productId": "101010610",
    "productName": "Viju Yoghurt Plain Sweet",
    "spec": "750ML",
    "weightPerCarton": 5,
    "quantityLeft": 120 }
]
```

**Exactly five fields.** `matchedOn` is gone.

| Field | Meaning |
|---|---|
| `productId` | ERP item code. **Can be `null`** — the ERP states one on only ~6% of line rows and 33 products have no code in any source |
| `productName` | `ITEM_DESCRIPTION`, verbatim |
| `spec` | `ITEM_SPECIFICATION`, Chinese category characters stripped. **Can be `null`** |
| `weightPerCarton` | kilograms. **Can be `null`** where the Viju specification sheet has no entry |
| `quantityLeft` | cartons still to collect **on this order** |

**`spec` is not decoration — it disambiguates.** The ERP gives two different
products the same name: `VIJU MULIIFRUIT FURIT JUICE` ships as both 100ML and
200ML. Show it beside the name, and **send it back** on the request.

Real specs are messier than the examples: `500ML*12/CTN(Ogun）` occurs, with a
full-width bracket. That is genuinely what the ERP holds — render it verbatim.

**Echo `productId`, `spec` and `weightPerCarton` back exactly as returned**,
`null`s included. Do not substitute `""` or `0`.

---

## 2. Create

```http
POST /api/v1/customers/me/waybills
```

Requires a T&C acceptance within the last hour
(`POST /customers/me/waybills/accept-terms`, body `{ "termsVersion": "…" }`).

```json
{
  "truckPlateNumber": "LAG-234-XY",
  "driverName": "Jimoh Ibrahim",
  "driverPhone": "+2348012345678",
  "customerId": "e8fef5ed-bdc5-4ee2-e902-1839e3c9ddd4",
  "requestedLoadingDate": "2026-06-15",
  "destination": "Yaba Warehouse",
  "warehouseName": "LAGOS WAREHOUSE",
  "loadingCapacity": 174,
  "products": [
    { "productId": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
      "spec": "100ML", "weightPerCarton": 2.7, "quantityLeft": 100, "quantityToLoad": 20 },
    { "productId": "101010610", "productName": "Viju Yoghurt Plain Sweet",
      "spec": "750ML", "weightPerCarton": 5, "quantityLeft": 120, "quantityToLoad": 24 }
  ]
}
```

### 2.1 Every field above is required

An empty body returns all eight at once:

```json
{ "message": [
    "customerId …", "destination …", "driverName …", "driverPhone …",
    "loadingCapacity …", "requestedLoadingDate …", "truckPlateNumber …",
    "warehouseName …" ],
  "error": "Bad Request", "statusCode": 400 }
```

`products` needs **at least one entry**, and the quantities must **add up to
more than zero**:

| Body | Response |
|---|---|
| `"products": []` | `400 "products must contain at least 1 elements"` |
| `products` omitted | `400 "products must contain at least one product to load."` |
| every line `quantityToLoad: 0` | `400 "The total quantityToLoad across products must be more than 0."` |
| any line negative | `400 "products.0.quantityToLoad must not be less than 0"` |

**A single line MAY be `0`.** A picker that lists every product on an order and
lets the distributor fill in only some of them can send zeros for the rest —
that is accepted, as long as the total is positive. Only a request where
*everything* is zero is refused.

You may still drop the zero lines before sending; both work. Sending them
records that the product was offered and left at zero.

`warehouseName` is one of exactly `LAGOS WAREHOUSE`, `OGUN WAREHOUSE`,
`ABUJA WAREHOUSE`. `requestedLoadingDate` is `YYYY-MM-DD`.

### 2.2 `customerId` is a cross-check, not a selector

It is **required**, and must be the signed-in distributor. The account still
comes from the token — this exists so a form with the wrong customer loaded
fails loudly instead of filing against the wrong account:

```json
{ "message": "customerId does not match the signed-in distributor. Omit it, or send your own id.",
  "error": "Forbidden", "statusCode": 403 }
```

### 2.3 `loadingCapacity` must EQUAL the weight of the load

```
loadingCapacity = Σ (quantityToLoad × weightPerCarton)
```

The worked example: `20 × 2.7 = 54`, `24 × 5 = 120`, total **174**.

**This is not a truck's rated capacity the load has to fit inside.** Compute
it from the lines and send that number. Anything else is refused:

```json
{ "message": "The products weigh 174kg but loadingCapacity says 173kg - a difference of 1kg. loadingCapacity must equal the sum of quantityToLoad x weightPerCarton across every product.",
  "error": "Bad Request", "statusCode": 400 }
```

Compute it in one place and recompute on **every** quantity change:

```ts
const loadingCapacity = Math.round(
  products.reduce((kg, p) => kg + p.quantityToLoad * (p.weightPerCarton ?? 0), 0) * 100,
) / 100;
```

Two easements, so the rule never rejects something it cannot judge:

- A line sending **no** `weightPerCarton` is weighed from the Viju
  specification sheet instead — omitting it does not skip the check.
- A product **neither** source can weigh is left out of the total and the
  request is allowed through.

### 2.4 The product line

| Field | Required | Notes |
|---|---|---|
| `productName` | **yes** | as the products endpoint returned it |
| `quantityToLoad` | **yes** | cartons to load — what the distributor typed. May be `0` on a line; the TOTAL must exceed 0 |
| `productId` | no | echo it back; `null` is fine |
| `spec` | no | echo it back |
| `weightPerCarton` | no | echo it back; drives the capacity check |
| `quantityLeft` | no | echo it back; stored as a snapshot of what was shown |

`quantityLeft` is recorded, **not enforced** — the client supplies it, so it is
not trusted as a limit. Enforce it in the UI.

The former name `quantity` is still accepted, and `quantityToLoad` wins when
both are present. A line with neither is refused:

> `"Mr V Premium Table Water(Lagos)" states no quantityToLoad.`

### 2.5 `linkedPurchaseId` is now optional

The request is filed against the **account**, not an order. Send it only if you
still track one; it changes the `reference` format:

| Sent | `reference` |
|---|---|
| an order | the ERP `DOC_NO`, e.g. `2300-202606110059` |
| nothing | `LR-<erpId>-<date>`, e.g. `LR-10110003-20260902` |

Either way a second load on the same day gets a `-02` suffix. **Treat
`reference` as opaque** and never parse it.

### Response — `201`

The created request, in the same shape as §5 (detail).

---

## 3. Edit — NEW

```http
PATCH /api/v1/customers/me/waybills/{id}
```

Send only what changed. Every field from §2 is optional here.

```json
{ "driverName": "Musa Danjuma",
  "loadingCapacity": 108,
  "products": [
    { "productId": "101020104", "productName": "Mr V Premium Table Water(Lagos)",
      "spec": "100ML", "weightPerCarton": 2.7, "quantityLeft": 100, "quantityToLoad": 40 }
  ] }
```

**Three rules:**

1. **Only while `PENDING_ASSIGNMENT`.** Once a regional admin has assigned it
   or an officer has started loading, people are working to what it says.
   Anything else is **`409`**, not `403` — the request is real and yours, the
   *state* refuses:
   > `This loading request is assigned and can no longer be edited. Cancel it and raise a new one.`

2. **`products` replaces the lines wholesale.** Omit it to leave them alone.
   There is no way to edit one line — send the whole list.

3. **`loadingCapacity` is re-checked against the merged result.** Change
   quantities without resending the capacity and you get:
   > `The products weigh 135kg but loadingCapacity says 108kg…`

   **Always send `products` and `loadingCapacity` together.**

The same total rule applies: an edit that zeroes **every** line is refused
with `400 "The total quantityToLoad across products must be more than 0."`
Emptying a live request is what cancelling is for.

`reference` never changes — it is what the depot and the ERP know the request
by.

Returns the updated request in the §5 shape.

---

## 4. List

```http
GET /api/v1/customers/me/waybills?page=1&pageSize=20&sortBy=status&sortOrder=asc
```

```json
{
  "data": [{
    "id": "99b11c0b-d512-4b4f-8f58-b0b1a2c2bdbc",
    "reference": "2300-202606020009-02",
    "customerId": "f4065cfe-682e-4864-9e7a-49e0a3b0f244",
    "truckPlateNumber": "fyt234xc",
    "driverName": "adebayom",
    "driverPhone": "0816254813",
    "requestedLoadingDate": "2026-09-02T00:00:00.000Z",
    "quantityCartons": 7200,
    "destination": "lagos",
    "status": "PENDING_ASSIGNMENT",
    "warehouseName": "LAGOS WAREHOUSE",
    "loadingCapacity": 1200,
    "description": null,
    "cancelReason": null,
    "accountOfficers": [
      { "id": "82c3a13e-…", "name": "Funmi Adelaja",
        "email": "officer.lagos1@viju.local", "phone": "+2349010000013",
        "isPrimary": true }
    ],
    "products": [
      { "id": "cd7c34ed-…", "productId": "101020104",
        "productName": "Mr V Premium Table Water(Lagos)",
        "spec": null, "quantity": 7200, "weightPerCarton": 9.38 }
    ],
    "createdAt": "2026-09-01T13:11:14.001Z"
  }],
  "meta": { "total": 12, "page": 1, "pageSize": 1, "totalPages": 12,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

### New fields

| Field | Notes |
|---|---|
| `customerId` | the distributor this belongs to |
| `accountOfficers` | who to contact. **May be `[]`** when nobody is assigned |
| `description` | what the **loading officer** wrote. `null` until they write something |
| `cancelReason` | why a regional admin or account officer cancelled. `null` unless `status` is `CANCELLED` |

`accountOfficers` are **account** officers and may be named. The **loading**
officer on a request is never named — see §5.

### Removed

`linkedPurchaseId`, `linkedPurchase` and `linkedPurchaseIds` are **gone** from
the list. `reference` still carries the ERP document number.

### The product row

**One row per PRODUCT, not per stored line.** A request holding the same
`productId` twice — from two orders, or entered twice — comes back merged with
the quantities added:

```
submitted: 20 cartons + 30 cartons of 101020105
returned : one row, quantity 50
```

Merged on `productId`; a line with no code falls back to name + spec. The `id`
is the **first** underlying line's — a merged row has no id of its own, so do
not use it as an edit or delete key.

### Sorting

`sortBy` = `createdAt` (default, newest first) · `status` · `requestedLoadingDate`.
`sortOrder` = `asc` · `desc` (default).

**`sortBy=status&sortOrder=asc` gives lifecycle order**, not alphabetical:

```
PENDING_ASSIGNMENT → ASSIGNED → LOADING_IN_PROGRESS → COMPLETED → CANCELLED
```

so what still needs doing comes first. Ties break on `createdAt` descending,
so pages cannot shuffle between requests.

---

## 5. Detail

```http
GET /api/v1/customers/me/waybills/{id}
```

Everything the list row carries — `customerId`, `accountOfficers`,
`description`, `cancelReason`, the same merged `products` rows — **plus**:

```json
{
  "id": "99b11c0b-…",
  "reference": "2300-202606020009-02",
  "status": "PENDING_ASSIGNMENT",
  "region": "LAGOS",
  "quantityCartons": 7200,
  "loadingCapacity": 1200,
  "termsAcceptedAt": "2026-09-01T13:11:13.768Z",
  "assignedOfficerId": null, "assignedAt": null, "loadingStartedAt": null,
  "completedAt": null, "cancelledAt": null, "waybillDocumentUrl": null,
  "descriptionUpdatedAt": null, "notes": null,

  "accountOfficers": [ … ],
  "assignedOfficer": null,

  "orders": [
    { "purchaseId": "2f24dc9b-…",
      "erpId": "2300-202606020009",
      "orderDate": "2026-06-02T00:00:00.000Z",
      "orderStatus": "CLOSED",
      "orderTotalItems": 2080,
      "orderTotalValue": 2900000,
      "isPrimary": true,
      "productLines": 1,
      "totalCartons": 2000,
      "totalWeightKg": 18760,
      "weightIsComplete": true,
      "products": [ … ] }
  ],

  "totals": { "orders": 2, "productLines": 2, "totalCartons": 7200,
              "totalWeightKg": 67536, "weightIsComplete": true },

  "products": [ … ]
}
```

**`orders` is the per-order breakdown** — the same lines grouped by the order
they came from, each with its own totals. It is **`[]` on requests raised
without an order**, which is now the normal case. Render from `products` and
show `orders` only when it is non-empty.

Three fields to read carefully:

- **`orderTotalItems` is the whole ORDER**, not this load. Above: the order
  holds 2,080 cartons and the load takes 2,000.
- **`weightIsComplete: false`** means at least one line has no carton weight,
  so `totalWeightKg` is a partial sum. Show `18,760 kg +` or a dash — never as
  the total.
- **`assignedOfficer`** is the **loading** officer and is `null` until one is
  assigned, then always the generic label:
  ```json
  "assignedOfficer": { "displayName": "Viju Loading Officer" }
  ```
  Never a real name (PRD F6). That is different from `accountOfficers`, who
  **are** named.

`totals.totalCartons` always equals `quantityCartons`.

Like the list, the detail no longer carries `linkedPurchaseId`,
`linkedPurchase` or `linkedPurchaseIds`.

---

## 6. Errors

| Status | When |
|---|---|
| `401` | missing, invalid or expired token |
| `403` | T&C not accepted in the last hour |
| `403` | `customerId` is not the signed-in distributor |
| `400` | a required field is missing (array of messages) |
| `400` | `products` empty or absent |
| `400` | every `quantityToLoad` is 0 — the total must exceed 0 |
| `400` | a `quantityToLoad` is negative |
| `400` | `loadingCapacity` ≠ the weight of the load |
| `400` | a line states no `quantityToLoad` |
| `400` | `warehouseName` not one of the three |
| `404` | no such request for this distributor |
| `409` | **edit only** — the request is no longer `PENDING_ASSIGNMENT` |

**Nothing is written when a request is rejected.** Every check runs before the
row is created, so a `400` is safe to fix and resend.

Two worth handling specially:

- **`403` on terms** — call `accept-terms` silently and retry once, rather
  than showing an error the distributor cannot act on.
- **`409` on edit** — refresh the request and show its new status. The edit
  screen should not have been reachable.

---

## 7. Migration checklist

**Breaking — the app must ship with the backend:**

- [ ] **`loadingCapacity` is now the load's weight**, not the truck's rated
      capacity, and must match to the kilogram. Relabel the field and compute
      it from the lines.
- [ ] **`customerId` is required** on create.
- [ ] **`destination` and `warehouseName` are required** on create.
- [ ] **A request with no products is refused.** It used to be accepted with a
      bare `quantityCartons`.

**Response changes:**

- [ ] `products` rows lost `purchaseId` / `orderReference`, gained `spec`
- [ ] `products` rows are **merged by `productId`** — do not sum them yourself
- [ ] `linkedPurchaseId` / `linkedPurchase` / `linkedPurchaseIds` gone from
      list **and** detail
- [ ] `matchedOn` gone from the products endpoint
- [ ] new: `customerId`, `accountOfficers`, `description`, `cancelReason`

**New capability:**

- [ ] `PATCH /customers/me/waybills/{id}` — wire up an edit screen, enabled
      only while `PENDING_ASSIGNMENT`
- [ ] `?sortBy=status&sortOrder=asc` for a "what needs attention" ordering

---

## 8. TypeScript

```ts
export type WarehouseName =
  | 'LAGOS WAREHOUSE' | 'OGUN WAREHOUSE' | 'ABUJA WAREHOUSE';

export type LoadingRequestStatus =
  | 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'LOADING_IN_PROGRESS'
  | 'COMPLETED' | 'CANCELLED';

/** A row from GET /erp/orders/{orderId}/products. */
export interface OrderProduct {
  productId: string | null;
  productName: string;
  spec: string | null;
  weightPerCarton: number | null;
  quantityLeft: number;
}

/** A line on the way IN. */
export interface SubmitProduct {
  productId?: string | null;
  productName: string;
  spec?: string | null;
  weightPerCarton?: number | null;
  quantityLeft?: number;
  quantityToLoad: number;
}

export interface CreateLoadingRequest {
  truckPlateNumber: string;
  driverName: string;
  driverPhone: string;
  customerId: string;
  requestedLoadingDate: string;   // YYYY-MM-DD
  destination: string;
  warehouseName: WarehouseName;
  loadingCapacity: number;        // = Σ quantityToLoad × weightPerCarton
  products: SubmitProduct[];      // >= 1
  linkedPurchaseId?: string | string[];
}

export type EditLoadingRequest = Partial<CreateLoadingRequest>;

/** A product row on the way OUT — one per product, merged. */
export interface LoadingRequestProduct {
  id: string;                     // first underlying line; not an edit key
  productId: string | null;
  productName: string;
  spec: string | null;
  quantity: number;               // summed across merged lines
  weightPerCarton: number | null;
}

export interface AccountOfficer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface LoadingRequestRow {
  id: string;
  reference: string;              // opaque
  customerId: string;
  truckPlateNumber: string;
  driverName: string;
  driverPhone: string;
  requestedLoadingDate: string;
  quantityCartons: number | null;
  destination: string | null;
  status: LoadingRequestStatus;
  warehouseName: WarehouseName | null;
  loadingCapacity: number | null;
  description: string | null;     // the LOADING officer's note
  cancelReason: string | null;
  accountOfficers: AccountOfficer[];
  products: LoadingRequestProduct[];
  createdAt: string;
}

export interface LoadingRequestOrderBreakdown {
  purchaseId: string;
  erpId: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  orderTotalItems: number | null; // the whole ORDER, not this load
  orderTotalValue: number | null;
  isPrimary: boolean;
  productLines: number;
  totalCartons: number;
  totalWeightKg: number;
  weightIsComplete: boolean;      // false => partial sum
  products: LoadingRequestProduct[];
}

export interface LoadingRequestDetail extends LoadingRequestRow {
  region: string;
  termsAcceptedAt: string;
  assignedOfficerId: string | null;
  assignedAt: string | null;
  loadingStartedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  descriptionUpdatedAt: string | null;
  waybillDocumentUrl: string | null;
  notes: string | null;
  updatedAt: string;
  /** Always the label "Viju Loading Officer", never a name. */
  assignedOfficer: { displayName: string } | null;
  orders: LoadingRequestOrderBreakdown[];   // [] when no order was named
  totals: {
    orders: number;
    productLines: number;
    totalCartons: number;         // equals quantityCartons
    totalWeightKg: number;
    weightIsComplete: boolean;
  };
}
```

---

## 9. Building the create body

```ts
// One place, called on every quantity change.
const weighLoad = (products: SubmitProduct[]) =>
  Math.round(
    products.reduce(
      (kg, p) => kg + p.quantityToLoad * (p.weightPerCarton ?? 0), 0,
    ) * 100,
  ) / 100;

const products = catalogue
  .map((p) => ({
    productId: p.productId,          // echo, nulls included
    productName: p.productName,
    spec: p.spec,
    weightPerCarton: p.weightPerCarton,
    quantityLeft: p.quantityLeft,
    quantityToLoad: quantities[p.productName] ?? 0,
  }))
  // Zeros are ACCEPTED on individual lines, so this filter is optional -
  // keep it if you would rather send only what is being loaded.
  .filter((p) => p.quantityToLoad > 0);

const totalCartons = products.reduce((n, p) => n + p.quantityToLoad, 0);
if (totalCartons === 0) {
  // Block locally - the API refuses it, but say so before the round trip.
}

const body: CreateLoadingRequest = {
  truckPlateNumber, driverName, driverPhone,
  customerId: me.id,
  requestedLoadingDate,               // 'YYYY-MM-DD'
  destination,
  warehouseName,
  loadingCapacity: weighLoad(products),
  products,
};
```

Deriving `loadingCapacity` from the same array you send makes the mismatch
`400` structurally impossible.

---

## 10. Checklist

- [ ] `accept-terms` called within the hour before create
- [ ] All eight create fields sent; `products` never empty
- [ ] `loadingCapacity` derived from the lines, recomputed on every change
- [ ] `productId` / `spec` / `weightPerCarton` echoed verbatim, `null`s kept
- [ ] The total `quantityToLoad` is > 0 before submitting (zeros on individual
      lines are fine)
- [ ] Edit screen only while `PENDING_ASSIGNMENT`; `409` handled
- [ ] `products` sent with `loadingCapacity` on every edit
- [ ] Response `products` rendered as-is — already merged
- [ ] `orders` rendered only when non-empty
- [ ] `weightIsComplete: false` shown as a minimum or a dash
- [ ] `accountOfficers` named; `assignedOfficer` shown as the generic label
- [ ] `reference` treated as opaque
