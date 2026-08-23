# Frontend Guide — Unread Count & Distributor Push (round 2: C-1, P-1…P-5)

**Answers:** `BACKEND_REQUEST_SENDER_ROLE_AND_NOTIFICATIONS.md` §1b (round 2)
**Backend branch:** `dev`
**Date:** 23 Aug 2026
**Scope:** C-1, P-1, P-2, P-3, P-4, P-5. Round 1 (S-1, N-1…N-4, F-1) is closed and untouched.

> **All six are done.** One new route, one behaviour change on an existing
> route, and four notification bodies now match the spec's wording exactly.
> **No breaking changes** — every existing field, route and response shape is
> as it was.

---

## 0. Summary

| # | Outcome | What you should do |
|---|---|---|
| **C-1** | **Fixed — it was cause (b).** Nothing marked staff-side messages read, so `unReadMessage` could never fall. `GET /chat/{customerId}` now marks the thread read for staff, **and** `PATCH /chat/{customerId}/read` was added. `unReadMessage` does count messages still unread by staff. | Nothing is strictly required — your existing refetch now works. Optionally call the new PATCH to clear the count without refetching the thread. |
| **P-1** | **Done.** Title is now `Loading update`, and the status word is derived from the status actually reached. | Nothing. Keep rendering `content`. |
| **P-2** | **Done.** Title is now `Loading complete`; push `data` carries `reference` and `attachmentUrl`. | Deep-link from `data.attachmentUrl` on the mobile app. |
| **P-3** | **Done.** Regional broadcast `content` is the admin's text **verbatim** — the `"Viju: "` prefix is gone. | Stop expecting a `": "` in a `BROADCAST` row from a regional send. See §4. |
| **P-4** | **Done.** `content` is `"<Distributor name>: <message>"` — the double prefix (`"Viju: ADLAK: …"`) is gone. | Nothing, but note the content genuinely changed. |
| **P-5** | **Done.** Amount is read back from the credited `Payment`, formatted as currency, never rounded. Push `data` carries `allowanceAmount` and `creditedAt`. | Nothing. Optionally use `data.allowanceAmount` instead of parsing the text. |

**Deploy note:** no database migration in this release. C-1 changes data
(`Message.readAt` starts being stamped) but adds no column.

---

## 1. C-1 — the "Unread Messages" tile

### What was actually wrong

It was **your possibility (b)**, not (a). Nothing marked staff-side messages
read, so no amount of refetching could have moved the number.

The dashboard tile counts:

```ts
prisma.message.count({ where: { senderType: 'CUSTOMER', readAt: null } })
```

…and the only read-marking that existed was `PATCH /chat/me/read`, which
stamps `senderType: 'STAFF'` — the **distributor's** side of the thread.
Customer-authored rows were never stamped by anything. The counter could only
ever rise.

**So yes:** `unReadMessage` counts messages still unread *by staff*, not all
inbound messages ever. It was the read-marking that was missing, not the count.

### What changed

**Both** remedies you offered are now in place.

#### (a) Opening the thread marks it read

`GET /api/v1/chat/{customerId}` now stamps that customer's unread messages
when the caller is an `OFFICER`, `ADMIN` or `REGIONAL_ADMIN`.

This means **your already-shipped fix now works**: your 30-second stale window,
refetch-on-focus and invalidate-on-open will show the count falling, with no
further frontend change.

A `CUSTOMER` calling the same route is unaffected — their read-marking still
goes through `PATCH /chat/me/read` and stamps the other direction. The two
counters stay independent.

#### (b) An explicit route, for clearing without re-fetching

```http
PATCH /api/v1/chat/{customerId}/read
```

**Roles:** `OFFICER`, `ADMIN`, `REGIONAL_ADMIN`
**Params:** `customerId` — the distributor whose inbound messages are read.

**200 response**

```json
{
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "markedRead": 3
}
```

`markedRead` is how many rows this call actually moved from unread to read.
It is **idempotent** — call it twice and the second returns `markedRead: 0`.

**Authorisation** matches reading the thread exactly: an `OFFICER` must be
assigned to the customer (primary or secondary), a `REGIONAL_ADMIN` is held to
their own region (403 outside it), an `ADMIN` reaches every region.

### How to use it

Since `GET /chat/{customerId}` already marks read, this route is **only**
needed when you want the count cleared *without* pulling the thread. Two cases
where that is worth doing:

```ts
// 1. The admin dismisses a conversation from a list without opening it.
await api.patch(`/chat/${customerId}/read`);
queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });

// 2. Optimistically drop the tile the instant a thread opens, without
//    waiting for the thread fetch to come back.
const { markedRead } = await api.patch(`/chat/${customerId}/read`);
if (markedRead > 0) {
  queryClient.setQueryData(['admin', 'dashboard'], (old) =>
    old ? { ...old, unReadMessage: Math.max(0, old.unReadMessage - markedRead) } : old,
  );
}
```

`markedRead` is what makes the second pattern safe: you are decrementing by the
number the server actually cleared, not by a number you counted locally.

### `GET /admin/dashboard` — unchanged shape

```json
{
  "totalCustomers": 1851,
  "totalActiveCustomers": 4,
  "customersWithoutOfficer": 0,
  "openTickets": 2,
  "unReadMessage": 0,
  "lastErpSyncAt": "2026-08-23T06:10:00.000Z"
}
```

No field was added or removed. `unReadMessage` simply becomes capable of
falling.

> **One caveat, so it does not surprise you.** Because opening a thread marks
> it read, `unReadMessage` is now shared state across staff. If an admin opens
> ADLAK's conversation, the tile falls for **every** admin — the message has
> been read by staff, and the count measures exactly that. It is not a
> per-viewer inbox. If you need "unread by *me*", that is a different feature
> and a different column; tell us and we will scope it rather than bending this
> one.

---

## 2. P-1 — loading status change

Fires on `PATCH /api/v1/loading/queue/{id}/status`, on the distributor's own
feed (`staffId: null`).

```json
{
  "id": "p1…",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "staffId": null,
  "content": "Loading update: Your loading status is now: Loading in Progress",
  "isRead": false,
  "type": "WAYBILL_STATUS_CHANGED",
  "createdAt": "2026-08-23T09:10:00.000Z"
}
```

The title is now `Loading update` (it was `Loading status update`), so the
content matches your spec exactly. Splitting on the first `": "` gives:

- title → `Loading update`
- body → `Your loading status is now: Loading in Progress`

**The status word is human-readable and derived**, never an enum in either
vocabulary. The full map:

| DB status | Text in the notification |
|---|---|
| `PENDING_ASSIGNMENT` | Pending Assignment |
| `ASSIGNED` | Assigned |
| `LOADING_IN_PROGRESS` | Loading in Progress |
| `COMPLETED` | Completed |
| `CANCELLED` | Cancelled |

**On "every forward move":** worth being precise, because it affects how many
notifications you should expect. The transition table only permits
`ASSIGNED → IN_PROGRESS`, `ASSIGNED → COMPLETED` and `IN_PROGRESS → COMPLETED`
— anything else is refused with a 409. So today the only
`WAYBILL_STATUS_CHANGED` a distributor can receive is **Loading in Progress**;
every other legal move is a completion and arrives as `WAYBILL_COMPLETED`
(§3). The wording is derived rather than hard-coded so that widening the
transition table later cannot silently start sending the wrong status — but
do not build UI expecting an `Assigned` or `Cancelled` push today.

Push `data`: `{ "waybillId": "lr-1" }`.

---

## 3. P-2 — loading completion / waybill issued

Fires on `POST /api/v1/loading/queue/{id}/waybill`, **and** on a status move
straight to `COMPLETED` — both are completions and both send the identical
notification, so you cannot get a bare status row for a finished load.

```json
{
  "id": "p2…",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "staffId": null,
  "content": "Loading complete: Your loading is complete. View your waybill in the app.",
  "isRead": false,
  "type": "WAYBILL_COMPLETED",
  "createdAt": "2026-08-23T09:20:00.000Z"
}
```

Push `data`:

```json
{
  "waybillId": "lr-1…",
  "reference": "WB-00231",
  "attachmentUrl": "https://cdn…/waybill.pdf"
}
```

### Deep-linking

```ts
if (payload.data?.attachmentUrl) {
  openDocument(payload.data.attachmentUrl);     // straight to the waybill
} else {
  navigateToWaybill(payload.data.waybillId);    // fall back to the detail screen
}
```

> **`attachmentUrl` is omitted, never the string `"null"`.** FCM `data` values
> are strings, so a missing document sent naively would arrive as the four
> characters `null` and your `if` would pass. The key is dropped instead —
> always test for presence, as above.
>
> You noted the frontend now requires a document before completing a load, so
> in practice `attachmentUrl` will be there. The guard covers loads completed
> through the status route by an older client.

---

## 4. P-3 — regional broadcast ⚠️ behaviour change

Fires on `POST /api/v1/admin/broadcasts/regional`, once per distributor in
**every** selected region.

```json
{
  "id": "p3…",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "staffId": null,
  "content": "Stock arrives Monday. Place orders before Friday 5pm.",
  "isRead": false,
  "type": "BROADCAST",
  "createdAt": "2026-08-23T09:30:00.000Z"
}
```

`content` is the admin's text **verbatim** — confirmed, and it is what ships.

### ⚠️ This is a real change to what you receive

It previously arrived as `"Viju: Stock arrives Monday…"`. The `"Viju: "`
prefix is **gone**, because the spec asks for no prefix or decoration.

**A regional `BROADCAST` row therefore has no `": "` separator to split on.**
Your `NotificationItem` splits on the first `": "` to get a title and body — a
regional broadcast now has no title, and worse, a message that happens to
contain a colon (`"Note: depot closed"`) would split at the wrong place and
lose the first word.

Special-case `BROADCAST` rather than splitting it:

```ts
function renderNotification(n: NotificationItem) {
  if (n.type === 'BROADCAST') {
    // Never split a broadcast — the text is the admin's own words, and an
    // individual broadcast's "<name>: " prefix is part of the message.
    return { title: null, body: n.content };
  }
  const at = n.content.indexOf(': ');
  return at === -1
    ? { title: null, body: n.content }
    : { title: n.content.slice(0, at), body: n.content.slice(at + 2) };
}
```

The `-1` fallback matters on its own: any type whose content lacks `": "` must
render as a bare body rather than an empty row.

---

## 5. P-4 — individual broadcast, no allowance

Fires on `POST /api/v1/admin/broadcasts/individual`.

```json
{
  "id": "p4…",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "staffId": null,
  "content": "ADLAK: Your March invoice is ready for review.",
  "isRead": false,
  "type": "BROADCAST",
  "createdAt": "2026-08-23T09:35:00.000Z"
}
```

**Format confirmed as specified:** `[Distributor name]: [message text]`. We
have reproduced the spec's asymmetry with the regional row verbatim rather
than normalising it, exactly as you asked.

> **On your question about it reading oddly.** You are right that a distributor
> seeing their own name in front of a message addressed to them is unusual —
> that is a real product question, not a technical one. We have implemented the
> spec as written so we are not diverging from you. If the client agrees to
> drop the prefix it is a one-line change here; raise it and we will make it.

Note this also fixes a genuine bug: the content used to be
`"Viju: ADLAK: Your March invoice…"` — the name prefix was in the body while
the title added a second one. That double prefix is gone.

Push `data`: `{ "broadcastId": "br-1" }`.

---

## 6. P-5 — individual broadcast with a delivery allowance

```json
{
  "id": "p5…",
  "customerId": "bd5dbe51-b00e-4d05-a321-76108e0f3918",
  "staffId": null,
  "content": "ADLAK: Thanks for the bulk order. Delivery allowance of ₦1,500.50 has been credited to your wallet.",
  "isRead": false,
  "type": "BROADCAST",
  "createdAt": "2026-08-23T09:40:00.000Z"
}
```

Push `data`:

```json
{
  "broadcastId": "br-1…",
  "allowanceAmount": "1500.5",
  "creditedAt": "2026-08-23T09:39:58.000Z"
}
```

### The three guarantees you asked for

**1. The amount is read back from the credited payment, not echoed from the
request.** The figure in the text comes from the `Payment` row that was
actually written. If the wallet were ever credited with a different amount
than requested, the distributor is told the amount they actually got.

**2. If the credit fails, the distributor is told nothing.** The wallet update
and the `Payment` insert are one transaction. If it throws, the whole request
fails and **no notification is written** — a distributor is never told about
money that is not there.

**3. Ordering is guaranteed: the credit lands before the push.** The
transaction commits before the notification is composed, so a distributor who
opens the app on the notification finds the balance already updated. This is
pinned by a test that asserts the call order.

### On precision — your AO-D1 note

Honoured. The amount is formatted with thousands separators and a **minimum**
of 2 decimal places, and is **never rounded**:

| Credited | Rendered |
|---|---|
| `1500.5` | `₦1,500.50` |
| `2000` | `₦2,000.00` |
| `1500.5678` | `₦1,500.5678` |

So the text a distributor reads and the balance they then open agree exactly.

`data.allowanceAmount` is the raw number as a string (`"1500.5"`) — parse that
rather than the formatted text if you need the value:

```ts
const amount = Number(payload.data.allowanceAmount);   // 1500.5
const creditedAt = new Date(payload.data.creditedAt);
```

### Punctuation

The spec's format is `[message]. Delivery allowance of [amount]…`. An admin
who already ended their message with `.`, `!` or `?` would produce a doubled
stop, so an existing terminator is kept rather than another appended:

- `"Thanks for the bulk order"` → `"…bulk order. Delivery allowance of…"`
- `"Thanks for the bulk order."` → `"…bulk order. Delivery allowance of…"` (not `"order.."`)
- `"Ready?"` → `"Ready? Delivery allowance of…"`

---

## 7. What did NOT change

So you can scope your regression pass:

- **No migration.** No column added, no schema change.
- **No route removed or renamed.** `PATCH /chat/{customerId}/read` is purely additive.
- **`GET /chat/{customerId}` response shape is unchanged** — same bare array, same fields, including the round-1 `staff` block. Only the side effect (marking read) is new.
- **`GET /admin/dashboard` shape is unchanged.**
- **`GET /notifications/me` shape is unchanged** — same envelope, same fields. Only `content` wording changed, on the four types above.
- **Round 1 is untouched.** `staff: { id, name, role }`, the `CHAT_MESSAGE` single-recipient rule, `WAYBILL_SUBMITTED` / `WAYBILL_ASSIGNED` / `ASSIGNMENT` audiences and flyer `description` all behave exactly as documented in the round-1 guide.
- **`PATCH /chat/me/read` is unchanged** — customers still mark their own side, and it does not touch the staff count.

### Content strings that changed

Worth a look if you snapshot-test notification copy:

| Type | Before | After |
|---|---|---|
| `WAYBILL_STATUS_CHANGED` | `Loading status update: Your loading status is now: Loading in Progress` | `Loading update: Your loading status is now: Loading in Progress` |
| `WAYBILL_COMPLETED` | `Loading status update: Your loading is complete…` | `Loading complete: Your loading is complete…` |
| `BROADCAST` (regional) | `Viju: <message>` | `<message>` |
| `BROADCAST` (individual) | `Viju: <name>: <message>` | `<name>: <message>` |

---

## 8. Test coverage backing this

| Item | Spec file |
|---|---|
| C-1 | `src/modules/chat/chat-staff-read.spec.ts` (9 tests) |
| P-1, P-2 | `src/modules/loading/loading-push.spec.ts` (5 tests) |
| P-3, P-4, P-5 | `src/modules/broadcast/broadcast-push.spec.ts` (9 tests) |

Includes the ordering guarantee (credit before push), the failed-credit case,
the amount being read from the payment rather than the request, precision
preservation, and the authorisation rules on the new route.

Full suite: **323 passing, 23 suites.**
