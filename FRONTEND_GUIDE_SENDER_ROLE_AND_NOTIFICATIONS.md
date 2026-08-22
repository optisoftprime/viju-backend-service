# Frontend Guide — Sender Role, Per-Recipient Notifications & Flyer Details

**Answers:** `BACKEND_REQUEST_SENDER_ROLE_AND_NOTIFICATIONS.md` (raised 22 Aug 2026)
**Backend branch:** `dev`
**Base URL:** every path below is prefixed with `/api/v1`
**Swagger:** `/api/docs`

All six items are implemented or confirmed. Section 1 is the scan; section 2 is
the per-item detail; section 3 lists the behaviour changes that touch shipped
code; section 4 is the deploy note (this release adds a database column).

---

## 1. Summary

| # | What you asked for | Answer | Fallback you can delete |
|---|---|---|---|
| **S-1** | `staff: { id, name, role }` on every staff-authored reply and message | **Done** on all six routes. `role` is the wire enum. | Nothing to delete — `resolveSenderLabel()` starts working on deploy |
| **N-1** | One recipient per `CHAT_MESSAGE`, `staffId` always populated | **Done.** Exactly one row, addressed to the staff member the conversation belongs to. | `scopeNotifications()` — keep as a belt-and-braces guard if you like, it will never fire |
| **N-2** | `WAYBILL_SUBMITTED` to the region's regional admins only | **Already correct, and tightened.** Never `ADMIN`, never `OFFICER`; now also skips deactivated admins. | The audience map entry (harmless) |
| **N-3** | Confirm `WAYBILL_ASSIGNED` reaches the assigned officer | **Confirmed — it was already written.** Now carries the waybill reference, as you asked. | — |
| **N-4** | Confirm `ASSIGNMENT` goes to the incoming officer only | **Confirmed**, and pinned by a test. The outgoing officer is **not** notified — no type needed. | — |
| **F-1** | Nullable `description` on the flyer record | **Done**, plus it now reaches the distributor app's home carousel. | The `400`-retry-without-`description` path |

---

## 2. Per-item detail

### S-1 — the sender's role on every staff message

A new `staff` block appears on staff-authored rows, on all six routes:

```json
"staff": { "id": "1a55…", "name": "Chidi Nwosu", "role": "REGIONAL_ADMIN" }
```

`role` is the wire enum — `ADMIN` | `REGIONAL_ADMIN` | `OFFICER` |
`LOADING_OFFICER`. No display text comes from the API, exactly as you asked, so
backend copy can never drift into your labels.

| Route | Where `staff` appears |
|---|---|
| `GET /tickets/{id}` | each `replies[]` entry |
| `POST /tickets/{id}/replies` | each `replies[]` entry of the returned thread, and on `reply` |
| `GET /chat/{customerId}` | each message |
| `POST /chat/{customerId}` | the created message |
| `GET /chat/audit/{customerId}` | each message |
| `GET /admin/audit/tickets` | each `replies[]` entry (`role` joins the `id`/`name` that were already there) |
| `GET /admin/audit/chats` | each `messages[]` entry |

**`staff` is `null` on a customer-authored row.** This matters more than it
looks: a chat row written by a distributor still stores a `staffId` — it is the
officer the message was routed **to**, not its author. Naming them as the
sender would be wrong, so the block is nulled whenever
`senderType !== "STAFF"`. Branch on `staff`, not on `staffId`.

**One deliberate exception — the distributor's own chat view.** PRD F6 says a
distributor sees one label, "Viju Account Officer", and never an individual
staff name. So when the **caller is a `CUSTOMER`**, `GET /chat/{officerId}`
returns `staff: null` on every row. Their own app already renders
`senderLabel` from `GET /chat/me`, which is unchanged. Every staff caller —
officer, admin, regional admin — gets the full block.

> Ticket threads are **not** subject to F6: a distributor reading
> `GET /tickets/{id}` does see `staff.role`, which is what makes your §3
> example (a regional admin stepping in) render correctly on the customer side
> too.

Example — `GET /tickets/{id}`:

```json
{
  "id": "9f1c…", "ticketId": "TCK-00123", "status": "IN_PROGRESS",
  "replies": [
    {
      "id": "4b8e…", "senderType": "STAFF",
      "staffId": "7c2a…",
      "staff": { "id": "7c2a…", "name": "Ifeanyi Okon", "role": "OFFICER" },
      "content": "Checking with finance now.",
      "createdAt": "2026-08-21T10:02:11.000Z"
    },
    {
      "id": "4b8f…", "senderType": "STAFF",
      "staffId": "1a55…",
      "staff": { "id": "1a55…", "name": "Chidi Nwosu", "role": "REGIONAL_ADMIN" },
      "content": "Escalated to finance.",
      "createdAt": "2026-08-21T11:40:00.000Z"
    },
    {
      "id": "4b90…", "senderType": "CUSTOMER",
      "staffId": null, "staff": null,
      "content": "Thank you.",
      "createdAt": "2026-08-21T11:55:00.000Z"
    }
  ]
}
```

Nothing was removed: `staffId` stays exactly where it was, so any code matching
on it keeps working while you migrate to `staff.role`.

---

### N-1 — one recipient per chat notification

**Confirmed and enforced:** a `CHAT_MESSAGE` row is now written for **exactly
one** staff member — the one the conversation belongs to, taken from the
`staffId` stored on the message itself.

| Who wrote the message | Who gets the staff row |
|---|---|
| Distributor via `POST /chat/me` | the **primary** officer |
| Distributor via `POST /chat/{officerId}` | that officer |
| Officer / admin / regional admin | nobody on staff — only the distributor's own row |

A second officer on the same account, an admin and a regional admin now get
nothing. The live `chat.message` frame on `/realtime/stream` follows the same
single recipient, so the bell and the socket agree.

> ⚠️ This narrowed an existing behaviour. See §3.1.

**`staffId` is the recipient, always.** Every staff-bound row carries it, and
it is never the sender. That is the guarantee your `scopeNotifications()`
addressee check was written against — it will now never drop anything.

**`customerId` on a staff row is the subject, not the recipient.** Your example
showed both fields populated, and that is what ships:

```json
{
  "id": "n1…",
  "customerId": "bd5d…",   // the distributor this row is ABOUT — deep-link target
  "staffId": "7c2a…",      // the recipient
  "content": "New message from ADLAK: Any update?",
  "isRead": false,
  "type": "CHAT_MESSAGE",
  "createdAt": "2026-08-22T09:10:00.000Z"
}
```

So a bell row can open the right customer's thread without a second lookup. It
is populated on `CHAT_MESSAGE`, `TICKET_CREATED`, `TICKET_REPLY`,
`WAYBILL_SUBMITTED`, `WAYBILL_ASSIGNED` and `ASSIGNMENT`.

A **customer's own** row keeps `staffId: null` — the shape your guard already
recognises. And a customer never reads a staff row that merely names them: the
customer feed now filters on `staffId: null` explicitly, so the two never mix.

**You can trust `unread` again.** Because the fan-out is per-recipient, the
server's count and the rows the panel can show are the same set. Point the
badge back at `unread` rather than the recounted figure; there is nothing left
for the client to filter out. (Keeping `serverUnread` around costs nothing if
you would rather migrate slowly.)

---

### N-2 — a new loading request

**Already correct**, and now slightly tighter. `POST` of a loading request
writes one `WAYBILL_SUBMITTED` row per **`REGIONAL_ADMIN` of that request's own
region** and nobody else — never `ADMIN`, never `OFFICER`.

Two refinements:

* Deactivated regional admins are now skipped (`isActive: true`), so a retired
  account stops accruing a queue it will never work.
* `content` now reads
  `"New loading request: ADLAK raised a loading request in LAGOS"`, matching the
  copy in your example (it was `"… ADLAK — LAGOS"`).

To your question: **no, an organisation-wide admin is not meant to see loading
activity through this type.** If that is wanted later it should be a separate
audience, as you suggested — say the word and we will name a type rather than
widening this one.

A region with no regional admin writes no rows at all; the request is still
created.

---

### N-3 — assigning a loading request

**Confirmed: the row was already being written**, on
`PATCH /regional/loading-requests/{id}/assign`, addressed to the assigned
loading officer. It is now pinned by a test so it cannot silently regress.

One change you asked for: it carries the waybill reference.

```json
{
  "id": "n3…",
  "customerId": "bd5d…",
  "staffId": "5c7b…",
  "content": "Loading request assigned: ADLAK — WB-00231 is ready for loading",
  "isRead": false,
  "type": "WAYBILL_ASSIGNED",
  "createdAt": "2026-08-22T09:15:00.000Z"
}
```

`data.reference` and `data.waybillId` are on the push payload too.

**One row goes to staff — the assigned officer.** The distributor also gets a
`WAYBILL_ASSIGNED` row on **their own** feed (`staffId: null`), which is their
bell, not a staff one; your addressee guard already separates them.

---

### N-4 — customer assigned to an officer

**Confirmed, unchanged, and now pinned by a test.**
`PATCH /admin/customers/{id}/reassign` writes exactly **one** notification,
addressed to the **incoming** officer:

```json
{
  "customerId": "bd5d…",
  "staffId": "7c2a…",
  "content": "Customer assigned: Ade Foods Ltd has been assigned to you",
  "type": "ASSIGNMENT"
}
```

The `content` format you render against — `"<title>: <body>"` — is exactly as
documented. In-app **and** web push, on a first assignment as well as a
reassignment.

**The outgoing officer is not notified at all**, so there is no second type to
map. If losing an account should be announced, that is a new type and audience;
it does not exist today and nothing will arrive on the wrong bell.

Not notified: the outgoing officer, the acting admin, the regional admin.

---

### F-1 — flyer details

`ProductFlyer` gains a nullable `description` column (max 500 chars, matching
your form's cap). **Delete the retry-without-`description` path** — the field
now persists.

**`GET /admin/product-flyers` → 200**

```json
[
  {
    "id": "f1…",
    "name": "December Bulk Offer",
    "imageUrl": "https://cdn…/flyer.jpg",
    "description": "Buy 50 cartons of Viju Milk between 1-31 December and get 5 free. Offer applies to Lagos and Western distributors only.",
    "sortOrder": 1,
    "isActive": true,
    "createdById": "1a55…",
    "createdAt": "2026-08-14T09:22:10.004Z",
    "updatedAt": "2026-08-22T09:40:00.000Z"
  }
]
```

`description` is **always present**, `null` when blank and on every flyer
created before the column existed — never absent, never an error.

**`POST /admin/product-flyers` → 201** — `description` optional. Omit it, or
send `""`, and the flyer stores `null`. It is trimmed on the way in and echoed
back on the created flyer.

**`PATCH /admin/product-flyers/{id}` → 200** — the three cases you specified,
all three distinct:

| You send | Result |
|---|---|
| property omitted | stored copy **unchanged** |
| `"description": ""` | **cleared** to `null` |
| `"description": "text"` | **replaced** (trimmed) |

Whitespace-only counts as blank, so `"   "` clears it. Over 500 characters is a
`400` from the validation pipe.

**It reaches the distributor app too.** `GET /customers/home` →
`productFlyers[]` now carries `description` alongside `id`, `imageUrl` and
`name`. That was the point of the copy — unsearchable text baked into artwork
does not reach a distributor — so shipping it only to the admin list would have
left the feature half-done. `null` where blank; render nothing for it.

---

## 3. Behaviour changes to shipped code

### 3.1 Chat notifications now reach one officer, not every officer on the account

Previously a distributor's chat message notified **every** officer currently
managing that account — primary and secondary — plus the officer it was
addressed to. That is what N-1 asked us to narrow, and it is now exactly one
recipient.

**What you will see:** on accounts with a single officer, nothing changes. On
accounts with a primary **and** a secondary officer, the secondary officer stops
receiving `CHAT_MESSAGE` rows and stops receiving the live `chat.message` frame
for conversations they are not part of.

The thread itself is untouched: both officers still **read** the whole history
through `GET /chat/{customerId}`, and either can still reply. Only the
notification and the live frame narrowed. If a secondary officer is meant to be
alerted as well, that is a product decision — tell us and we will add them back
deliberately rather than by fan-out.

### 3.2 A customer's bell filters on `staffId: null`

Now that a staff row names the distributor it concerns in `customerId`,
`GET /notifications/me` for a customer, `PATCH /notifications/{id}/read` and
`PATCH /notifications/me/read-all` all require `staffId: null`. Without it a
staff row about a customer would surface in that customer's own feed.

**What you will see:** nothing. No row in the database today has both fields
set, so this is a no-op on existing data and a guard on new data.

### 3.3 Two notification bodies changed wording

* `WAYBILL_SUBMITTED`: `"… ADLAK — LAGOS"` → `"… ADLAK raised a loading request in LAGOS"`
* `WAYBILL_ASSIGNED` (staff): `"… Assigned to you — ADLAK"` → `"… ADLAK — WB-00231 is ready for loading"`

Both match the copy in your request. `content` is still `"<title>: <body>"`.

---

## 4. Deploy note

This release adds a database column, so it needs a migration —
`prisma/migrations/20260822000000_product_flyer_description`:

```bash
npx prisma migrate deploy   # production
npx prisma generate         # regenerate the client
```

The migration is a single additive `ALTER TABLE … ADD COLUMN "description" TEXT`.
It is nullable with no default, so it is safe on a live table and existing
flyers read back `null` rather than `""` — "never written" stays
distinguishable from "deliberately cleared".

> If `prisma generate` reports `EPERM … query_engine-windows.dll.node` locally,
> a running `node` process is holding the engine binary. Stop the dev server and
> re-run. The TypeScript client regenerates regardless; only the native binary
> swap is blocked.

---

## 5. Quick reference

### The `staff` block

```ts
export type StaffRole =
  | 'ADMIN' | 'REGIONAL_ADMIN' | 'OFFICER' | 'LOADING_OFFICER';

export interface StaffSender {
  id: string;
  name: string;
  role: StaffRole;
}
```

Present on ticket replies and chat messages where `senderType === 'STAFF'`;
`null` otherwise, and `null` for a `CUSTOMER` caller on the chat routes (PRD F6).

### Notification addressing

| Field | On a staff row | On a customer row |
|---|---|---|
| `staffId` | the **recipient**, always set | `null` |
| `customerId` | the distributor the row is **about**, or `null` | the **recipient** |

| `type` | Audience |
|---|---|
| `CHAT_MESSAGE` | the one staff member the conversation belongs to; or the distributor |
| `TICKET_CREATED` / `TICKET_REPLY` | the officers on the account, or the distributor |
| `TICKET_STATUS` | the distributor |
| `ASSIGNMENT` | the **incoming** officer only |
| `WAYBILL_SUBMITTED` | active `REGIONAL_ADMIN`s of the request's region only |
| `WAYBILL_ASSIGNED` | the assigned loading officer; plus the distributor |
| `WAYBILL_STATUS_CHANGED` / `WAYBILL_COMPLETED` / `BROADCAST` | the distributor |

### Flyer

```ts
export interface ProductFlyer {
  id: string;
  name: string;
  imageUrl: string;
  description: string | null;  // ≤ 500 chars
  sortOrder: number;
  isActive: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Related

[`FRONTEND_GUIDE_INTERACTION_AUDIT.md`](./FRONTEND_GUIDE_INTERACTION_AUDIT.md) ·
[`FRONTEND_GUIDE_ACCOUNT_OFFICER.md`](./FRONTEND_GUIDE_ACCOUNT_OFFICER.md) ·
[`FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md`](./FRONTEND_GUIDE_REGIONAL_CUSTOMERS.md)
