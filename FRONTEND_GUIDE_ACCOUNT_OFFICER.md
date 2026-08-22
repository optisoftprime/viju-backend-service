# Frontend Guide — Account Officer Dashboard Interactivity

**Answers:** `BACKEND_API_REQUESTS_ACCOUNT_OFFICER.md` (raised 22 Aug 2026)
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs` → *Officer Portal* and *Support Tickets*

All five items are implemented or answered. Section 1 is the scan; section 2 is
what to change per screen; section 3 lists the two behaviour changes that touch
code already shipped.

---

## 1. Summary

| # | What you asked for | Answer | Fallback you can delete |
|---|---|---|---|
| **AO-C1** | `unreadMessages` + `lastMessageAt` per row, and a `?unreadMessages=true` filter | **Done.** Both fields on every row, plus the filter and two new sort columns. Row counts sum to the dashboard tile. | Reading the notification feed for a `customerId` |
| **AO-T1** | `customerId` + `status` on `GET /tickets/officer` | **Done.** Both applied in SQL, `meta.total` counts the filtered set. Rows also gained `repliesCount` and a fuller `customer`. | Page-filtering by customer; fetching 50 to find an open one |
| **AO-P1** | Confirm the `{ data, meta }` envelope | **Confirmed** — it always was, and is now covered by tests. `pageSize` is echoed as applied; `search` matches name, account number **and** phone server-side. | Defensive `meta` fallback (harmless to keep) |
| **AO-P2** | `stockBalanceCartons` per row | **Done.** Same figure `GET /admin/customers` returns, from a shared helper. | The em-dash STOCK column |
| **AO-D1** | Guarantee full-precision numbers | **Held — and one violation found and fixed.** The statement ledger was rounding ERP values to 2 dp. | Nothing |

---

## 2. Per-item wiring

### AO-C1 — which customer has an unread message

`GET /api/v1/officers/customers` rows now carry:

| Field | Type | Meaning |
|---|---|---|
| `unreadMessages` | `number` | Messages **the distributor sent** that are still unread. Always present; `0` when nothing is waiting, never omitted. |
| `lastMessageAt` | `string \| null` | Most recent message on the thread, either side. `null` on an empty thread. |

**The filter:** `?unreadMessages=true` returns only distributors with at least
one unread message — the "waiting on me" list. It mirrors `activeTickets=true`,
is applied in SQL, and `meta.total` counts the filtered set.

**The tile now works directly.** Instead of scraping the notification feed:

```ts
// Unread Messages tile → the customer who has waited longest.
const { data } = await api.get(
  '/officers/customers?unreadMessages=true&sortBy=lastMessageAt&sortOrder=asc&pageSize=1',
);
const target = data.data[0];           // undefined ⇒ genuinely nothing waiting
// → select `target.id`, open the Chat tab, load GET /chat/{target.id}
```

This does not go stale when the officer marks the bell read: it reads
`Message.readAt`, not notifications.

**Two new sort columns** — `sortBy=unreadMessages` and `sortBy=lastMessageAt`,
both with `sortOrder`. `lastMessageAt` **ascending** puts the distributor who
has been waiting longest first. Rows with no message sort **last in both
directions**, so "never contacted" stays at the bottom of the table.

> `lastMessageAt` is not the same as `lastContactDate`. `lastContactDate` keeps
> its documented fallback to `customer.updatedAt` so the column is never empty;
> `lastMessageAt` is `null` when the thread is genuinely empty, which is what
> makes it correct to sort on. Both are returned; nothing changed about
> `lastContactDate`.

**The tile and the list agree by construction.** `unreadMessages` per row uses
the identical predicate as the `unreadMessages` figure on
`GET /officers/dashboard` (`senderType: 'CUSTOMER'`, `readAt: null`), so summing
the column across the portfolio equals the tile. See §3.1 for the one change
that was needed to make that true.

**Example — `GET /officers/customers?unreadMessages=true&page=1&pageSize=20`**

```json
{
  "data": [
    {
      "id": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
      "name": "ADLAK",
      "accountNumber": "10110003",
      "phone": "+2348168584112",
      "region": "LAGOS",
      "walletBalance": -10140600.1232,
      "stockBalanceCartons": 240,
      "accountStatus": "ACTIVE",
      "openTickets": 2,
      "unreadMessages": 3,
      "lastMessageAt": "2026-08-22T07:41:00.000Z",
      "lastPurchaseDate": "2026-08-19T00:00:00.000Z",
      "lastContactDate": "2026-08-21T16:02:00.000Z"
    }
  ],
  "meta": {
    "total": 4,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

---

### AO-T1 — filtering the officer's tickets

`GET /api/v1/tickets/officer` takes two new query parameters. Both run in SQL,
so `meta.total` counts the filtered set and the pager agrees with the rows.

| Param | Notes |
|---|---|
| `customerId` | Exact UUID. Narrows to one distributor, for the Tickets tab inside a detail view. |
| `status` | The ticket enum. **Repeatable** (`?status=OPEN&status=IN_PROGRESS`) or **comma-separated** (`?status=OPEN,IN_PROGRESS`). Case-insensitive, de-duplicated. Omit for every status. |

`status` behaves **identically** to the filter on `GET /admin/audit/tickets` —
the two share one implementation, so anything you built for RA-T1 transfers
unchanged.

**The Tickets tab:**

```ts
await api.get(`/tickets/officer?customerId=${customerId}&page=1&pageSize=20`);
```

**The Open Tickets tile** — one request instead of fetching 50 and scanning:

```ts
const { data } = await api.get(
  '/tickets/officer?status=OPEN,IN_PROGRESS,AWAITING_CUSTOMER&pageSize=1',
);
const ticket = data.data[0];   // undefined ⇒ nothing unresolved
```

**Rows gained two things** (additive — nothing was removed):

* `repliesCount` — number of replies on the thread, so the list can show a
  conversation badge without opening each one.
* `customer` widened from `{ name, erpId }` to
  `{ id, erpId, name, phone, email }`, so the tab can render the distributor
  header from the row it already holds.

**Errors — both `400`:**

```json
{ "message": "status must be one of: OPEN, IN_PROGRESS, AWAITING_CUSTOMER, RESOLVED",
  "code": "VALIDATION_ERROR", "statusCode": 400 }
```

```json
{ "message": "customerId does not match a distributor assigned to you",
  "code": "VALIDATION_ERROR", "statusCode": 400 }
```

The second covers a distributor outside the caller's own book as well as one
that does not exist. It is deliberately **not** an empty list — an empty list
reads as "this customer has no tickets" and hides the mistake. A malformed
(non-UUID) value is rejected by the validation pipe, also `400`.

A distributor who genuinely has no tickets returns `data: []` with a valid
`meta` — never a `404`.

**Example — `GET /tickets/officer?customerId=bd5d…&status=OPEN,IN_PROGRESS`**

```json
{
  "data": [
    {
      "id": "9f1c2b40-1f4e-4c3a-9a11-0b6d2f7c8e51",
      "ticketId": "TCK-00123",
      "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
      "category": "BILLING",
      "subject": "Wallet not credited",
      "description": "I paid on Monday and the wallet still shows the old balance.",
      "attachmentUrl": null,
      "status": "OPEN",
      "createdAt": "2026-08-20T09:14:02.000Z",
      "updatedAt": "2026-08-21T10:02:11.000Z",
      "repliesCount": 1,
      "customer": {
        "id": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
        "erpId": "10110003",
        "name": "ADLAK",
        "phone": "+2348168584112",
        "email": null
      }
    }
  ],
  "meta": {
    "total": 2, "page": 1, "pageSize": 20, "totalPages": 1,
    "hasNextPage": false, "hasPreviousPage": false
  }
}
```

Ordering is unchanged: `createdAt` descending.

---

### AO-P1 — the envelope, confirmed

`GET /api/v1/officers/customers` **always** returns the standard
`{ data, meta }` envelope. It is never an unpaginated array. Confirmed and now
pinned by tests:

| Guarantee | Detail |
|---|---|
| `meta` block | `total`, `page`, `pageSize`, `totalPages`, `hasNextPage`, `hasPreviousPage` — all six, always. |
| `meta.total` | Counts the rows the **current filter** matches, not the portfolio size. Every filter (`search`, `overdue`, `activeTickets`, `unreadMessages`) is applied in SQL and counted. |
| `pageSize` | Echoed **as applied**. Any positive integer is accepted and **clamped to 200** rather than rejected — read `meta.pageSize` back, do not assume you got what you sent. |
| `search` | Server-side, case-insensitive partial match on **name**, **account number (`erpId`)** *and* **phone**. |
| `totalPages` | `1` (not `0`) when `total` is `0`. |
| Empty result | `data: []` with a valid `meta`. Never a `404`, never a bare array. |

Your defensive `meta` reading is harmless to keep, but it will never fire.

---

### AO-P2 — stock balance per row

Every row now carries `stockBalanceCartons: number` — cartons paid for but not
yet loaded (ordered minus **COMPLETED** loading requests, floored at 0).

It is computed by the **same shared helper** that backs `GET /admin/customers`
and `GET /regional/customers`, so the STOCK column means exactly the same number
on all three screens. `0` means nothing is waiting.

Note the contract is slightly stronger than you asked for: it is always a
`number`, never `null`, on this route — an officer's rows always have a local
record. (`null` appears only on `GET /admin/customers` unprojected rows, which
an officer never sees.) The column no longer needs an em-dash branch here.

---

### AO-D1 — precision

Guarantee held for `outstandingBalance`, `walletBalance`, `creditLimit`,
`totalValue`, `deliveryAllowance`, `stockBalanceCartons` and `quantityCartons`:
all cross the wire as full-precision JSON numbers, never pre-rounded and never
preformatted strings.

**One violation existed and is fixed.** `GET /customers/statement` ran every
money figure through `Math.round(v * 100) / 100` before serialising — including
`debit` (from `Purchase.totalValue`) and `credit` (from `Payment.amount`), which
are ERP source values. A statement could disagree with the ERP by up to a kobo
per line, and the client could not recover the true figure. The rounding is
gone; `openingBalance`, `closingBalance`, `totalDebit`, `totalCredit`,
`runningBalance`, `debit` and `credit` are now full precision. See §3.2.

Rounding that remains is **not** money and is correct: carton counts
apportioned across products in a purchase are whole cartons, and
`loadingProgress` is an integer percentage.

---

## 3. Behaviour changes to code already shipped

Two changes go beyond adding fields. Both were needed to make the guarantees
above true; everything else in this release is additive.

### 3.1 `GET /officers/dashboard` now counts the officer's whole portfolio

The four tiles counted only customers where the officer is the **primary**
assignment (`assignedOfficerId`). `GET /officers/customers`, the ticket list and
chat access have always used **primary OR secondary**. So for any officer
holding a secondary assignment, the tiles under-reported and clicking one landed
on a list showing more rows than the number that was clicked.

The dashboard now uses the same portfolio definition as the list. Concretely:

| Tile | Before | Now |
|---|---|---|
| `totalDistributors` | primary only | primary **or** secondary |
| `overdueBalances` | primary only | primary **or** secondary |
| `openTickets` | primary only | primary **or** secondary |
| `unreadMessages` | primary only | primary **or** secondary |

**What you will see:** for officers with no secondary assignments, nothing
changes. For officers who hold some, every tile goes **up**, and now matches
`meta.total` on the list it opens. That is the point — the tiles are clickable
now, and a tile that disagrees with the screen it opens reads as a bug.

### 3.2 `GET /customers/statement` returns unrounded money

Per AO-D1 above. Line `debit` / `credit` and every balance and total are now
full precision instead of 2 dp.

**What you will see:** figures like `2700000.7512` where you previously got
`2700000.75`. If any statement view assumes at most two decimals — a fixed
column width, a `.toFixed(2)`-free raw render, or a string comparison — format
explicitly at render. The mobile and web formatters that already preserve what
they are given need no change.

This affects the statement screens only. `walletBalance` and
`outstandingBalance` were never rounded.

---

## 4. Quick reference

### `GET /api/v1/officers/customers`

Roles: `OFFICER` (own portfolio), `ADMIN` (org-wide).

| Param | Type | Notes |
|---|---|---|
| `search` | string | name / account number / phone, partial, case-insensitive |
| `overdue` | bool | negative balance only |
| `activeTickets` | bool | has an OPEN ticket |
| `unreadMessages` | bool | **new** — has an unread message from the distributor |
| `sortBy` | enum | `name` \| `accountNumber` \| `walletBalance` \| `lastPurchaseDate` \| `openTickets` \| `lastContactDate` \| **`unreadMessages`** \| **`lastMessageAt`** |
| `sortOrder` | `asc` \| `desc` | default `desc`; only applied with `sortBy` |
| `page` / `pageSize` | int | `pageSize` clamped to 200, echoed in `meta` |

Row: `id`, `name`, `accountNumber`, `phone`, `region`, `walletBalance`,
**`stockBalanceCartons`**, `accountStatus`, `openTickets`,
**`unreadMessages`**, **`lastMessageAt`**, `lastPurchaseDate`,
`lastContactDate`.

### `GET /api/v1/tickets/officer`

Roles: `OFFICER`.

| Param | Type | Notes |
|---|---|---|
| `customerId` | UUID | **new** — one distributor; must be in the caller's portfolio |
| `status` | enum[] | **new** — repeatable or comma-separated |
| `page` / `pageSize` | int | standard |

Row: the ticket, plus **`repliesCount`** and `customer`
`{ id, erpId, name, phone, email }`.

### Types

```ts
export interface OfficerCustomerRow {
  id: string;
  name: string;
  accountNumber: string;
  phone: string;
  region: 'LAGOS' | 'EASTERN' | 'SOUTH_SOUTH' | 'WESTERN' | 'NORTH';
  walletBalance: number;        // full precision
  stockBalanceCartons: number;  // 0 when nothing waiting
  accountStatus: 'ACTIVE' | 'ON_HOLD';
  openTickets: number;          // OPEN only
  unreadMessages: number;       // 0 when nothing waiting
  lastMessageAt: string | null; // null on an empty thread
  lastPurchaseDate: string | null;
  lastContactDate: string;      // falls back to customer.updatedAt
}

export type TicketStatus =
  | 'OPEN' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'RESOLVED';

export interface OfficerTicketRow {
  id: string;
  ticketId: string;
  customerId: string;
  category: string;
  subject: string;
  description: string;
  attachmentUrl: string | null;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  repliesCount: number;
  customer: {
    id: string; erpId: string; name: string;
    phone: string; email: string | null;
  };
}
```

### Error codes

| `code` | Status | Where |
|---|---|---|
| `VALIDATION_ERROR` | 400 | unknown `status`, or a `customerId` outside the caller's portfolio |

Bodies are `{ message, code, statusCode }`. Branch on `code`; `message` is safe
to display.

### Related

Admin and regional admin equivalents are in
[`FRONTEND_GUIDE_INTERACTION_AUDIT.md`](./FRONTEND_GUIDE_INTERACTION_AUDIT.md)
and
[`FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md`](./FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md).
